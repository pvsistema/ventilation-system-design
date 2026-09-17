using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace PvsApp;

public partial class MainWindow : Window
{
    private const int    Port            = 5173;
    // Версия берётся из сборки (тег <Version> в PvsApp.csproj, который читает
    // desktop/VERSION). Хардкода больше нет — единый источник версии.
    private static readonly string AppVersion = GetAppVersion();

    private static string GetAppVersion()
    {
        var info = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString()
            ?? "0.0.0";
        // Отбрасываем возможный суффикс сборки вида "2.0.17+abc123"
        var plus = info.IndexOf('+');
        return plus >= 0 ? info.Substring(0, plus) : info;
    }
    private const string VersionCheckUrl = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";
    private const string ServerUrl       = "http://127.0.0.1:5173";

    private Process?     _serverProcess;
    private string?      _pendingFile;
    // Содержимое файла, открытого двойным кликом: читается фоном с самого
    // старта, ещё до того как интерфейс успеет его запросить.
    private Task<object?>? _pendingRead;
    private UpdateInfo?  _updateInfo;
    // true — установленная сборка ниже минимальной безопасной: в ней осталась
    // устранённая уязвимость, работать нельзя до обновления.
    private bool         _securityUpdateRequired;
    // true — интерфейс загружен и виден. Нужен потому, что проверка обновлений
    // теперь идёт фоном и может завершиться как до показа окна, так и после:
    // по этому флагу решаем, кто именно покажет окно обязательного обновления,
    // чтобы оно не выскочило поверх заставки и не показалось дважды.
    private bool         _webViewReady;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    // Флаг: JS уже подтвердил закрытие — пропускаем повторный запрос
    private bool _closeConfirmed = false;

    public MainWindow(string? pendingFile)
    {
        InitializeComponent();
        _pendingFile = pendingFile;
        Closed  += OnClosed;
        Closing += OnWindowClosing;

        // Уведомляем JS при изменении состояния окна (развёрнуто / обычное)
        StateChanged += OnWindowStateChanged;

        // Безрамочное окно (WindowStyle=None) при максимизации перекрывает панель
        // задач и вылезает за экран. Перехватываем WM_GETMINMAXINFO и ограничиваем
        // размер рабочей областью текущего монитора.
        SourceInitialized += OnSourceInitialized;

        Loaded += async (_, _) =>
        {
            try { await StartupAsync(); }
            catch (Exception ex)
            {
                string log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PVS", "error.log");
                Directory.CreateDirectory(Path.GetDirectoryName(log)!);
                File.WriteAllText(log, $"{DateTime.Now}\n{ex}");
                MessageBox.Show($"Ошибка запуска:\n{ex.Message}\n\nЛог: {log}", "ПВ-Система", MessageBoxButton.OK, MessageBoxImage.Error);
                Application.Current.Shutdown();
            }
        };
    }

    // ── Запуск ────────────────────────────────────────────────────────────────

    private async Task StartupAsync()
    {
        // ── ПОРЯДОК ЗАПУСКА ПЕРЕСОБРАН РАДИ СКОРОСТИ ──────────────────────────
        // Раньше первым делом шёл поход в интернет за версией ядра: до 8 секунд
        // ожидания ответа, а при найденном обновлении — ещё и полная закачка
        // нового ядра (минуты на слабой связи). Всё это ВНУТРИ заставки, до
        // того как ядро вообще стартовало. Человек, открывший схему двойным
        // кликом, смотрел на надпись «Обновление расчётного ядра…» и ждал.
        //
        // Теперь: сначала поднимаем то ядро, которое уже лежит на диске, —
        // работать можно немедленно. Проверка и закачка обновления идут фоном
        // и НИКОГО не задерживают; готовое обновление подставляется при
        // следующем запуске одним переименованием файла (доли секунды).

        // Файл, открытый двойным кликом, начинаем читать ПРЯМО СЕЙЧАС —
        // параллельно со стартом ядра и загрузкой интерфейса. Схема на десятки
        // мегабайт читается с диска заметное время, и раньше это чтение
        // начиналось только после того, как React смонтировался и спросил файл:
        // ожидание диска честно прибавлялось к ожиданию запуска.
        if (_pendingFile is string startFile)
            _pendingRead = Task.Run(() => ReadPendingFile(startFile));

        // Обновление, скачанное в прошлый сеанс: только переименовать файл.
        ApplyPendingServerUpdate();

        SetStatus("Запуск расчётного ядра...");
        bool started = StartServerProcess();

        if (!started)
        {
            // Ядра на диске нет вообще (первый запуск после частичной
            // установки) — вот тут ждать закачку действительно приходится.
            SetStatus("Загрузка расчётного ядра...");
            await UpdateServerExeIfNeededAsync();
            ApplyPendingServerUpdate();
            if (!StartServerProcess())
            {
                MessageBox.Show("Расчётное ядро не найдено и не удалось его загрузить.\n\n" +
                                "Проверьте подключение к сети и переустановите программу.",
                                "ПВ-Система", MessageBoxButton.OK, MessageBoxImage.Error);
                Application.Current.Shutdown();
                return;
            }
        }

        // Пока ядро поднимается, параллельно готовим браузерный движок: его
        // создание — это 1–2 секунды, и раньше они шли ПОСЛЕ ожидания ядра,
        // хотя одно другому не мешает.
        var webViewReady = PrepareWebViewAsync();

        var checkUpdate = CheckForUpdateAsync();

        // Обновление ядра — строго фоном и НЕ во время запуска. Полминуты
        // отсрочки: пока грузится интерфейс и открывается схема, сеть и диск
        // нужны им, а не закачке файла, который понадобится только завтра.
        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30));
            await UpdateServerExeIfNeededAsync();
        });

        SetStatus("Ожидание расчётного ядра...");
        bool ready = await WaitForServerAsync();
        if (!ready)
        {
            // Диагностика вместо тупика: раньше пользователь видел только
            // «перезапустите приложение» и не знал, что делать. Пишем причину
            // в лог и показываем её — чаще всего сервер падает сразу после
            // старта (порт 5173 занят или антивирус заблокировал server.exe).
            string reason = _serverProcess == null
                ? "процесс ядра не был запущен"
                : (_serverProcess.HasExited
                    ? $"ядро завершилось с кодом {_serverProcess.ExitCode}"
                    : "ядро запущено, но не ответило за 40 секунд");

            string log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PVS", "server-error.log");
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(log)!);
                await File.WriteAllTextAsync(log, $"{DateTime.Now}\nПричина: {reason}\nURL: {ServerUrl}/api/status\n");
            }
            catch { }

            MessageBox.Show($"Не удалось запустить расчётный модуль.\n\nПричина: {reason}.\n\n" +
                            $"Проверьте, что порт {Port} не занят другой программой,\n" +
                            "и что антивирус не блокирует server.exe.\n\n" +
                            $"Подробности: {log}",
                            "ПВ-Система", MessageBoxButton.OK, MessageBoxImage.Error);
            Application.Current.Shutdown();
            return;
        }

        // ЗАПУСК НЕ ЖДЁТ ПРОВЕРКУ ОБНОВЛЕНИЙ.
        // Раньше здесь стояло ожидание ответа сервера версий (до 10 секунд по
        // таймауту Http). На руднике со слабой или обрывающейся связью человек
        // всё это время смотрел на заставку — хотя обновление никак не влияет
        // на то, можно ли уже начать работу.
        //
        // Теперь проверка продолжается в фоне, а интерфейс грузится сразу.
        // Когда ответ придёт, результат применяется задним числом: если версия
        // признана небезопасной, окно обязательного обновления всё равно
        // появится — на пару секунд позже, но НЕ пропадёт. Защита сохранена.
        _ = ApplyUpdateInfoWhenReadyAsync(checkUpdate);

        SetStatus("Загрузка интерфейса...");
        await webViewReady;          // движок обычно уже готов — ждать нечего
        NavigateToApp();
    }

    /// <summary>
    /// Подставляет ядро, скачанное фоном в прошлый сеанс: server.exe.new →
    /// server.exe. Это переименование файла, доли секунды, поэтому его не
    /// страшно делать прямо на старте.
    ///
    /// Разделение «скачали фоном → подставили при следующем запуске» и есть
    /// главная причина, по которой заставка больше не превращается в ожидание
    /// закачки: работающее ядро никогда не заменяется под запущенной программой.
    /// </summary>
    private void ApplyPendingServerUpdate()
    {
        try
        {
            string serverExe   = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server.exe");
            string pending     = serverExe + ".new";
            string pendingVer  = serverExe + ".newver";
            if (!File.Exists(pending)) return;

            if (File.Exists(serverExe))
            {
                string bak = serverExe + ".old";
                try { if (File.Exists(bak)) File.Delete(bak); } catch { }
                File.Move(serverExe, bak, overwrite: true);
                try { File.Delete(bak); } catch { /* держит антивирус — удалится позже */ }
            }
            File.Move(pending, serverExe, overwrite: true);

            if (File.Exists(pendingVer))
            {
                string versionFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server_version.txt");
                File.Move(pendingVer, versionFile, overwrite: true);
            }
        }
        catch (Exception ex) { LogIntegrity("Не удалось подставить обновление ядра: " + ex.Message); }
    }

    /// <summary>
    /// Досматривает фоновую проверку обновлений, начатую при запуске.
    /// Вызывается без ожидания, чтобы не задерживать показ интерфейса.
    ///
    /// Если к моменту ответа интерфейс уже загружен (обычный случай), окно
    /// обязательного обновления показываем здесь же. Если ответ пришёл раньше
    /// навигации — окно покажет OnNavigationCompleted по флагу, как и прежде.
    /// </summary>
    private async Task ApplyUpdateInfoWhenReadyAsync(Task<UpdateInfo?> checkUpdate)
    {
        UpdateInfo? info;
        try { info = await checkUpdate; }
        catch { return; }   // нет связи — работаем на текущей версии

        _updateInfo = info;

        // Обязательное обновление по безопасности. Показываем только если
        // интерфейс уже на экране: иначе окно выскочит поверх заставки, а
        // OnNavigationCompleted покажет его сам чуть позже.
        if (!_securityUpdateRequired || !_webViewReady) return;
        _securityUpdateRequired = false;
        await Dispatcher.InvokeAsync(ShowSecurityUpdateDialog,
            System.Windows.Threading.DispatcherPriority.Background);
    }

    private async Task UpdateServerExeIfNeededAsync()
    {
        try
        {
            string serverExe   = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server.exe");
            string versionFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server_version.txt");
            string localVer    = File.Exists(versionFile) ? File.ReadAllText(versionFile).Trim() : "";

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var resp = await Http.GetAsync(VersionCheckUrl, cts.Token);
            if (!resp.IsSuccessStatusCode) return;

            string json = await resp.Content.ReadAsStringAsync(cts.Token);
            if (string.IsNullOrWhiteSpace(json) || !json.TrimStart().StartsWith("{")) return;
            var info = JsonSerializer.Deserialize<VersionInfo>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            string remoteVer = info?.ServerVersion ?? "";
            if (string.IsNullOrEmpty(remoteVer)) return;
            // Версия совпала — качать нечего. Но если самого файла ядра на
            // диске нет (повреждённая установка), качаем даже при совпадении:
            // иначе запись о версии осталась бы, а работать было бы нечем.
            if (remoteVer == localVer && File.Exists(serverExe)) return;
            // Уже скачано фоном в прошлый раз и ждёт применения — не качаем второй раз.
            if (File.Exists(serverExe + ".new")
                && File.Exists(serverExe + ".newver")
                && File.ReadAllText(serverExe + ".newver").Trim() == remoteVer) return;

            // Заставку больше НЕ переписываем: закачка идёт фоном, во время
            // обычной работы. Надпись «Обновление расчётного ядра до vX» на
            // старте была honest-ложью — она означала «ждите столько, сколько
            // качается файл», хотя ждать было незачем.
            using var httpLarge = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            var bytes = await httpLarge.GetByteArrayAsync($"{VersionCheckUrl}?file=server");

            // Базовая проверка: валидный Windows-EXE (сигнатура "MZ") и размер.
            // Отсекает страницу ошибки CDN или оборванную закачку.
            if (bytes.Length < 1_000_000 || bytes[0] != 0x4D || bytes[1] != 0x5A)
                return;

            // ЗАЩИТА ОТ ПОДМЕНЫ ЯДРА. Раньше проверялась лишь сигнатура «MZ» —
            // подменив ответ, можно было подсунуть любой exe. Теперь сервер
            // присылает контрольную сумму подлинного ядра и её подпись; здесь
            // сверяем сумму скачанного файла и проверяем подпись публичным
            // ключом. Не сошлось или подписи нет — обновление отвергаем и
            // продолжаем работать на прежней рабочей версии.
            if (!VerifyServerBinary(bytes, info?.ServerSha256, info?.ServerSig))
            {
                LogIntegrity("Обновление ядра отклонено: не прошла проверка целостности/подписи");
                return;
            }

            // КЛАДЁМ РЯДОМ, А НЕ ПОВЕРХ. Работающее ядро не трогаем: оно занято
            // текущим сеансом, да и подменять его на ходу нельзя. Готовое ядро
            // ждёт в server.exe.new и встанет на место при следующем запуске
            // (ApplyPendingServerUpdate) — это переименование файла, мгновенно.
            string tmpPath = serverExe + ".new";
            await File.WriteAllBytesAsync(tmpPath, bytes);
            await File.WriteAllTextAsync(serverExe + ".newver", remoteVer);
            LogIntegrity($"Ядро v{remoteVer} загружено фоном, будет применено при следующем запуске");
        }
        catch
        {
            // Обновление не удалось — откатываемся на рабочую версию, чтобы
            // приложение всё равно запустилось. Недокачанный .new удаляем.
            try
            {
                string serverExe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server.exe");
                string tmpPath   = serverExe + ".new";
                if (File.Exists(tmpPath)) File.Delete(tmpPath);
                // Метку версии тоже убираем: недокачанный файл не должен
                // выглядеть как готовое к применению обновление.
                if (File.Exists(serverExe + ".newver")) File.Delete(serverExe + ".newver");
                string bakPath = serverExe + ".old";
                if (!File.Exists(serverExe) && File.Exists(bakPath))
                    File.Move(bakPath, serverExe, overwrite: true);
            }
            catch { }
        }
    }

    // ── Проверка целостности и подписи обновления ядра ──────────────────────────

    // Публичный ключ Ed25519 (base64url, 32 байта) — пара к серверному секрету
    // OFFLINE_KEY_PRIVATE. Тот же ключ проверяет лицензии и аварийные ключи.
    // НЕ секретный: им можно только проверять подпись, но не создавать её.
    private const string UpdatePublicKeyB64Url = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc";

    /// <summary>
    /// Проверяет скачанное ядро: совпадает ли SHA-256 с заявленным сервером и
    /// подписан ли этот хэш подлинным приватным ключом. Возвращает true только
    /// если оба условия выполнены. Пустой хэш или подпись — тоже отказ: без
    /// подтверждённой целостности обновление ставить нельзя.
    /// </summary>
    private static bool VerifyServerBinary(byte[] data, string? expectedSha256, string? sigB64Url)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(expectedSha256) || string.IsNullOrWhiteSpace(sigB64Url))
                return false;

            // 1. Контрольная сумма скачанного файла.
            string actual = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
            if (!string.Equals(actual, expectedSha256.Trim().ToLowerInvariant(), StringComparison.Ordinal))
                return false;

            // 2. Подпись hex-строки хэша (её и подписывает сервер).
            byte[] pub = FromBase64Url(UpdatePublicKeyB64Url);
            byte[] sig = FromBase64Url(sigB64Url.Trim());
            byte[] msg = Encoding.ASCII.GetBytes(actual);

            var verifier = new Ed25519Signer();
            verifier.Init(false, new Ed25519PublicKeyParameters(pub, 0));
            verifier.BlockUpdate(msg, 0, msg.Length);
            return verifier.VerifySignature(sig);
        }
        catch
        {
            return false;
        }
    }

    private static byte[] FromBase64Url(string s)
    {
        string b64 = s.Replace('-', '+').Replace('_', '/');
        switch (b64.Length % 4)
        {
            case 2: b64 += "=="; break;
            case 3: b64 += "="; break;
        }
        return Convert.FromBase64String(b64);
    }

    private static void LogIntegrity(string message)
    {
        try
        {
            string log = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PVS", "update.log");
            Directory.CreateDirectory(Path.GetDirectoryName(log)!);
            File.AppendAllText(log, $"{DateTime.Now:o}  {message}\n");
        }
        catch { }
    }

    /// <summary>
    /// Поднимает расчётное ядро. Возвращает false, если файла ядра на диске нет
    /// (тогда вызывающий код решает: качать или сдаваться) — раньше метод сам
    /// показывал ошибку и закрывал программу, из-за чего не было возможности
    /// попробовать восстановить ядро закачкой.
    /// </summary>
    private bool StartServerProcess()
    {
        string serverExe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server.exe");
        if (!File.Exists(serverExe)) return false;

        try
        {
            _serverProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName        = serverExe,
                    CreateNoWindow  = true,
                    UseShellExecute = false,
                }
            };
            _serverProcess.Start();
            return true;
        }
        catch { return false; }
    }

    // 40 с вместо 20: PyInstaller-onefile при первом запуске (и особенно после
    // обновления) распаковывает ядро во временную папку, а антивирус сканирует
    // свежий exe — на слабой машине 20 с не хватало, и приложение сдавалось на
    // рабочем ядре.
    private async Task<bool> WaitForServerAsync(int timeoutMs = 40_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        // Опрос УЧАЩЁН в начале: ядро на обычной машине поднимается за
        // 300–600 мс, а шаг в 200 мс отъедал до пятой доли секунды уже после
        // фактической готовности. Первые секунды спрашиваем каждые 50 мс, потом
        // разрежаем до 250 мс, чтобы не жечь процессор в долгом ожидании.
        var started = DateTime.UtcNow;
        while (DateTime.UtcNow < deadline)
        {
            // Ядро упало — ждать дальше бессмысленно, выходим сразу с причиной.
            if (_serverProcess != null && _serverProcess.HasExited) return false;
            try
            {
                using var probe = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                var resp = await Http.GetAsync($"{ServerUrl}/api/status", probe.Token);
                if (resp.IsSuccessStatusCode) return true;
            }
            catch { }
            int step = (DateTime.UtcNow - started).TotalSeconds < 3 ? 50 : 250;
            await Task.Delay(step);
        }
        return false;
    }

    // ── WebView2 ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Создаёт и настраивает браузерный движок, но НЕ открывает страницу.
    /// Разделение нужно, чтобы движок готовился параллельно с запуском ядра:
    /// раньше эти полторы–две секунды шли строго после ожидания ядра и просто
    /// складывались с ним.
    /// </summary>
    private async Task PrepareWebViewAsync()
    {
        string cacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PVS", "WebView2Cache");
        Directory.CreateDirectory(cacheDir);

        var env = await CoreWebView2Environment.CreateAsync(null, cacheDir);
        await WebView.EnsureCoreWebView2Async(env);

        WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled   = false;
        WebView.CoreWebView2.Settings.AreDevToolsEnabled              = false;
        WebView.CoreWebView2.Settings.IsStatusBarEnabled              = false;
        WebView.CoreWebView2.Settings.AreHostObjectsAllowed           = true;

        WebView.CoreWebView2.WebMessageReceived    += OnWebMessage;
        WebView.CoreWebView2.NavigationCompleted   += OnNavigationCompleted;

        // ── КРИТИЧНО: клавиши доставляем странице НАПРЯМУЮ ────────────────────
        // Раньше C# перехватывал S/Delete/Ctrl (WebView.KeyDown + e.Handled) и
        // пересоздавал синтетические KeyboardEvent через JS. Это ломало:
        //   • S+S (двойное нажатие) — сбивались тайминги между нажатиями;
        //   • Ctrl+клик (мультивыбор) — реальный keydown 'Control' не доходил
        //     до страницы, ctrlPressedRef оставался false, e.ctrlKey на мыши тоже;
        //   • Delete — синтетическое событие не совпадало с реальным.
        // Включаем нативную доставку клавиш — страница получает их как в браузере.
        WebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;

        // ── КРИТИЧНО: флаг десктопа + мост окна внедряем ДО загрузки страницы ──
        // AddScriptToExecuteOnDocumentCreatedAsync выполняется РАНЬШE скриптов React,
        // поэтому window.__IS_DESKTOP__ и __pvsWin* доступны уже при первом рендере.
        // Иначе React монтируется раньше бутстрапа, читает __IS_DESKTOP__ === undefined
        // и уходит в браузерную ветку — кнопки окна и close-диалог не работают.
        await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildEarlyBootstrap());

        WebView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);

        // ── КЭШ ЧИСТИМ ТОЛЬКО ПОСЛЕ ОБНОВЛЕНИЯ ПРОГРАММЫ ─────────────────────
        // Раньше кэш сбрасывался при КАЖДОМ запуске. Задумка была правильная —
        // после обновления не показывать старый интерфейс, — но цена оказалась
        // непомерной: браузер каждый раз заново качал и разбирал весь интерфейс
        // (несколько мегабайт скриптов), и это ложилось в заставку целиком.
        // Сравниваем версию, при которой кэш чистили в прошлый раз, с текущей:
        // совпала — кэш горячий, интерфейс поднимается почти мгновенно; сменилась
        // (то есть программу обновили) — чистим, как и прежде.
        try
        {
            string stamp = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PVS", "ui-cache-version.txt");
            string seen = File.Exists(stamp) ? File.ReadAllText(stamp).Trim() : "";
            if (seen != AppVersion)
            {
                await WebView.CoreWebView2.Profile.ClearBrowsingDataAsync(
                    CoreWebView2BrowsingDataKinds.DiskCache |
                    CoreWebView2BrowsingDataKinds.CacheStorage);
                Directory.CreateDirectory(Path.GetDirectoryName(stamp)!);
                await File.WriteAllTextAsync(stamp, AppVersion);
            }
        }
        catch { /* старая версия рантайма WebView2 — не критично, есть no-cache на сервере */ }
    }

    /// <summary>Открывает интерфейс. Движок к этому моменту уже готов.</summary>
    private void NavigateToApp() => WebView.CoreWebView2.Navigate(ServerUrl);

    // Ранний бутстрап: только флаг десктопа и мост управления окном.
    // Выполняется до скриптов страницы (document-created), поэтому React сразу
    // видит десктопный режим.
    private string BuildEarlyBootstrap()
    {
        string isMaxStr = WindowState == WindowState.Maximized ? "true" : "false";
        return $$"""
(function() {
    window.__IS_DESKTOP__       = true;
    window.__DESKTOP_SERVER__   = '{{ServerUrl}}';
    window.__pvsWindowMaximized = {{isMaxStr}};
    // Версия контракта прямой печати (см. src/lib/desktopPrint.ts). Только по
    // этому флагу диалог печати понимает, что доступна печать БЕЗ системного
    // окна: он запрашивает список принтеров Windows и печатает напрямую.
    // На старых сборках флага нет — веб-часть откатывается на печать через
    // окно браузера, поэтому программа не ломается.
    window.__PVS_PRINT_API__    = 1;
    // Оболочка сама умеет показывать окно обязательного обновления. Флаг
    // говорит веб-части не показывать своё — иначе на новых сборках человек
    // увидел бы два одинаковых требования подряд.
    window.__PVS_SECURITY_GATE__ = 1;

    function sendCs(cmd, params) {
        try { window.chrome.webview.postMessage(JSON.stringify(Object.assign({ cmd: cmd }, params || {}))); }
        catch (e) {}
    }
    window.__pvsSendCs      = sendCs;
    window.__pvsWinMinimize = function() { sendCs('win-minimize'); };
    window.__pvsWinMaximize = function() { sendCs('win-maximize'); };
    window.__pvsWinDrag     = function() { sendCs('win-drag'); };
    window.__pvsWinClose    = function() { sendCs('win-close'); };
    window.__pvsShowCloseDialog = function() { sendCs('win-close-confirmed'); };

    // ── Схема из проводника запрашивается НЕМЕДЛЕННО ─────────────────────────
    // Раньше содержимое файла запрашивалось только когда React смонтируется и
    // зарегистрирует обработчик — то есть после загрузки и разбора всего
    // интерфейса. Передача схемы на десятки мегабайт из оболочки в страницу
    // занимает своё время, и оно честно прибавлялось к ожиданию.
    // Теперь запрос уходит здесь, до единого скрипта страницы: пока грузится
    // интерфейс, файл уже едет. React потом просто забирает готовое.
    //
    // Реестр ответов заводим тут же — полный бутстрап (BuildJsBootstrap)
    // переиспользует и его, и слушателя: он создаёт их только если их ещё нет.
    window.__pvsPending = window.__pvsPending || {};
    window.__pvsCsReply = window.__pvsCsReply || function(reqId, payload) {
        var p = window.__pvsPending[reqId];
        if (!p) return;
        delete window.__pvsPending[reqId];
        if (p.timer) clearTimeout(p.timer);
        p.resolve(payload);
    };
    if (!window.__pvsReplyHooked) {
        window.__pvsReplyHooked = true;
        window.chrome.webview.addEventListener('message', function(e) {
            var d = e.data;
            if (!d || typeof d !== 'object' || typeof d.__pvsReply !== 'string') return;
            if (window.__pvsCsReply) window.__pvsCsReply(d.__pvsReply, d.payload);
        });
    }
    window.__pvsPendingFilePromise = new Promise(function(resolve) {
        var id = 'openfile_' + Math.random().toString(36).slice(2);
        // Срок ожидания щедрый: файл может лежать на сетевой папке рудника.
        var timer = setTimeout(function() {
            if (!window.__pvsPending[id]) return;
            delete window.__pvsPending[id];
            resolve({ error: 'Файл схемы не удалось прочитать за 60 с.' });
        }, 60000);
        window.__pvsPending[id] = { resolve: resolve, timer: timer };
        sendCs('get-pending-file', { reqId: id });
    });
})();
""";
    }

    // ── Закрытие окна (системная кнопка X / Alt+F4) ──────────────────────────

    private async void OnWindowClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Если WebView ещё не загружен или JS уже подтвердил — закрываем сразу
        if (WebView?.CoreWebView2 == null || _closeConfirmed)
            return;

        // Отменяем закрытие — спросим JS
        e.Cancel = true;

        try
        {
            // Проверяем через JS есть ли несохранённые данные
            string result = await WebView.CoreWebView2.ExecuteScriptAsync(
                "typeof window.__pvsCanClose === 'function' ? (window.__pvsCanClose() ? 'yes' : 'no') : 'yes'");

            if (result == "\"yes\"" || result == "true")
            {
                // Несохранённых данных нет — закрываем
                _closeConfirmed = true;
                Dispatcher.Invoke(() => Close());
            }
            else
            {
                // Просим JS показать диалог сохранения
                // JS в диалоге вызовет sendCs('win-close-confirmed') при "Не сохранять"
                // или sendCs('win-close-confirmed') после успешного сохранения
                await WebView.CoreWebView2.ExecuteScriptAsync(
                    "typeof window.__pvsShowCloseDialog === 'function' && window.__pvsShowCloseDialog()");
            }
        }
        catch
        {
            // При ошибке — закрываем без вопросов
            _closeConfirmed = true;
            Dispatcher.Invoke(() => Close());
        }
    }

    // ── Состояние окна → JS ───────────────────────────────────────────────────

    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        // Рамка ресайза (Margin вокруг WebView) нужна только в обычном режиме.
        // В развёрнутом окне убираем отступ — иначе по краям видна серая полоса.
        bool maximized = WindowState == WindowState.Maximized;
        var margin = maximized ? new Thickness(0) : new Thickness(ResizeBorder);
        if (WebView != null)  WebView.Margin  = margin;
        if (SplashGrid != null) SplashGrid.Margin = margin;

        if (WebView?.CoreWebView2 == null) return;
        string maxVal = maximized ? "true" : "false";
        _ = WebView.CoreWebView2.ExecuteScriptAsync(
            "window.__pvsWindowMaximized = " + maxVal + ";" +
            "window.dispatchEvent(new CustomEvent('pvs-window-state', { detail: { maximized: " + maxVal + " } }));");
    }

    // ── Корректная максимизация безрамочного окна (не перекрывать панель задач) ─

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(handle)?.AddHook(WindowProc);
    }

    private const int WM_GETMINMAXINFO = 0x0024;
    private const int WM_NCHITTEST     = 0x0084;
    private const int WM_NCLBUTTONDOWN = 0x00A1;

    // Коды зон окна для перетаскивания/ресайза (возврат из WM_NCHITTEST)
    private const int HTCAPTION     = 2;
    private const int HTLEFT        = 10;
    private const int HTRIGHT       = 11;
    private const int HTTOP         = 12;
    private const int HTTOPLEFT     = 13;
    private const int HTTOPRIGHT    = 14;
    private const int HTBOTTOM      = 15;
    private const int HTBOTTOMLEFT  = 16;
    private const int HTBOTTOMRIGHT = 17;

    // Толщина зоны захвата по краям окна для изменения размера (px)
    private const int ResizeBorder = 6;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    private IntPtr WindowProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        // ── Изменение размера безрамочного окна поверх WebView2 ────────────────
        // WebView2 (дочерний HWND браузера) закрывает окно целиком и «съедает»
        // стандартную рамку ресайза WPF. Поэтому сами обрабатываем WM_NCHITTEST:
        // если курсор у самого края окна — возвращаем код зоны ресайза, и Windows
        // рисует стрелку + позволяет тянуть край.
        if (msg == WM_NCHITTEST && WindowState != WindowState.Maximized)
        {
            int screenX = unchecked((short)((long)lParam & 0xFFFF));
            int screenY = unchecked((short)(((long)lParam >> 16) & 0xFFFF));

            var pt = PointFromScreen(new System.Windows.Point(screenX, screenY));
            double w = ActualWidth, h = ActualHeight;
            int b = ResizeBorder;

            bool left   = pt.X <= b;
            bool right  = pt.X >= w - b;
            bool top    = pt.Y <= b;
            bool bottom = pt.Y >= h - b;

            int code = 0;
            if (top && left)          code = HTTOPLEFT;
            else if (top && right)    code = HTTOPRIGHT;
            else if (bottom && left)  code = HTBOTTOMLEFT;
            else if (bottom && right) code = HTBOTTOMRIGHT;
            else if (left)            code = HTLEFT;
            else if (right)           code = HTRIGHT;
            else if (top)             code = HTTOP;
            else if (bottom)          code = HTBOTTOM;

            if (code != 0)
            {
                handled = true;
                return (IntPtr)code;
            }
        }

        if (msg == WM_GETMINMAXINFO)
        {
            const int MONITOR_DEFAULTTONEAREST = 0x00000002;
            IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var mi = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
                if (GetMonitorInfo(monitor, ref mi))
                {
                    RECT work = mi.rcWork;      // рабочая область (без панели задач)
                    RECT area = mi.rcMonitor;   // весь монитор
                    // PtrToStructure<T> возвращает T? (при Nullable enable) — берём
                    // значение через GetValueOrDefault, чтобы не было CS8629.
                    MINMAXINFO mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam)!;
                    mmi.ptMaxPosition.X  = Math.Abs(work.Left - area.Left);
                    mmi.ptMaxPosition.Y  = Math.Abs(work.Top  - area.Top);
                    mmi.ptMaxSize.X      = Math.Abs(work.Right  - work.Left);
                    mmi.ptMaxSize.Y      = Math.Abs(work.Bottom - work.Top);
                    Marshal.StructureToPtr(mmi, lParam, true);
                    handled = true;
                }
            }
        }
        return IntPtr.Zero;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int    cbSize;
        public RECT   rcMonitor;
        public RECT   rcWork;
        public uint   dwFlags;
    }

    // ── JS ↔ C# сообщения ────────────────────────────────────────────────────

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        Dispatcher.Invoke(() =>
        {
            SplashGrid.Visibility = Visibility.Collapsed;
            WebView.Visibility    = Visibility.Visible;
        });

        _webViewReady = true;
        _ = WebView.CoreWebView2.ExecuteScriptAsync(BuildJsBootstrap());

        // Обязательное обновление по безопасности. Показываем ПОСЛЕ загрузки
        // интерфейса и только один раз: так окно не появляется поверх пустого
        // экрана, а свежие сборки покажут собственное окно в веб-части.
        //
        // Проверка обновлений теперь идёт фоном и часто ещё не завершена к
        // этому моменту — тогда окно покажет ApplyUpdateInfoWhenReadyAsync,
        // как только придёт ответ сервера. Оба пути гасят флаг, поэтому
        // требование показывается ровно один раз, кто бы ни успел первым.
        if (_securityUpdateRequired)
        {
            _securityUpdateRequired = false;
            Dispatcher.InvokeAsync(ShowSecurityUpdateDialog,
                System.Windows.Threading.DispatcherPriority.Background);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string raw = e.TryGetWebMessageAsString();
        JsonDocument doc;
        try { doc = JsonDocument.Parse(raw); }
        catch { return; }

        string cmd = doc.RootElement.TryGetProperty("cmd", out var c) ? c.GetString() ?? "" : "";

        switch (cmd)
        {
            case "save-file":
                HandleSaveFile(doc.RootElement);
                break;
            // Работа с диском ЗАПУСКАЕТСЯ и отпускается: обработчик сообщений
            // не ждёт её завершения, иначе поток окна снова оказался бы занят
            // ожиданием диска. Ответ уйдёт сам, когда файл будет прочитан.
            case "read-file":
                _ = HandleReadFile(doc.RootElement);
                break;
            case "write-file":
                _ = HandleWriteFile(doc.RootElement);
                break;
            case "get-pending-file":
                _ = HandleGetPendingFile(doc.RootElement);
                break;
            case "install-update":
                _ = HandleInstallUpdate();
                break;
            case "list-printers":
                HandleListPrinters(doc.RootElement);
                break;
            case "print-html":
                _ = HandlePrintHtml(doc.RootElement);
                break;
            case "win-minimize":
                Dispatcher.Invoke(() => WindowState = WindowState.Minimized);
                break;
            case "win-maximize":
                Dispatcher.Invoke(() => WindowState = WindowState == WindowState.Maximized
                    ? WindowState.Normal : WindowState.Maximized);
                break;
            case "win-close":
                // JS кнопка "✕" — JS уже показал свой диалог и подтвердил
                _closeConfirmed = true;
                Dispatcher.Invoke(() => Close());
                break;
            case "win-close-confirmed":
                // JS явно подтвердил закрытие (после диалога "Не сохранять")
                _closeConfirmed = true;
                Dispatcher.Invoke(() => Close());
                break;
            case "win-drag":
                Dispatcher.Invoke(() =>
                {
                    // ВАЖНО: DragMove() ненадёжен, когда событие пришло из WebView2
                    // (мышь захвачена дочерним HWND браузера). Используем нативный
                    // способ перетаскивания окна: отпускаем захват и шлём окну
                    // WM_NCLBUTTONDOWN с кодом HTCAPTION — Windows сам начинает drag.
                    try
                    {
                        var h = new WindowInteropHelper(this).Handle;
                        if (h != IntPtr.Zero)
                        {
                            ReleaseCapture();
                            SendMessage(h, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                        }
                    }
                    catch { }
                });
                break;
        }
    }

    // ── Диалог сохранения файла ───────────────────────────────────────────────

    private void HandleSaveFile(JsonElement root)
    {
        string filename = root.TryGetProperty("filename", out var fn) ? fn.GetString() ?? "file" : "file";
        string data     = root.TryGetProperty("data",     out var d)  ? d.GetString()  ?? ""     : "";
        string reqId    = root.TryGetProperty("reqId",    out var r)  ? r.GetString()  ?? ""     : "";

        Dispatcher.Invoke(() =>
        {
            string ext = Path.GetExtension(filename).ToLowerInvariant();
            var (filter, defExt) = ext switch
            {
                ".png"  => ("PNG файлы|*.png|Все файлы|*.*",          "png"),
                ".jpg"  => ("JPEG файлы|*.jpg|Все файлы|*.*",         "jpg"),
                ".jpeg" => ("JPEG файлы|*.jpg|Все файлы|*.*",         "jpg"),
                ".bmp"  => ("BMP файлы|*.bmp|Все файлы|*.*",          "bmp"),
                ".tiff" => ("TIFF файлы|*.tiff|Все файлы|*.*",        "tiff"),
                ".svg"  => ("SVG файлы|*.svg|Все файлы|*.*",          "svg"),
                ".pdf"  => ("PDF файлы|*.pdf|Все файлы|*.*",          "pdf"),
                ".xlsx" => ("Excel файлы|*.xlsx|Все файлы|*.*",       "xlsx"),
                ".dxf"  => ("DXF файлы|*.dxf|Все файлы|*.*",         "dxf"),
                ".csv"  => ("CSV файлы|*.csv|Все файлы|*.*",          "csv"),
                _       => ("Все файлы|*.*",                           ext.TrimStart('.')),
            };

            var dlg = new SaveFileDialog
            {
                FileName         = filename,
                DefaultExt       = defExt,
                Filter           = filter,
                AddExtension     = true,
                OverwritePrompt  = true,
            };

            bool? result = dlg.ShowDialog(this);
            if (result != true)
            {
                ReplyToJs(reqId, new { ok = false, cancelled = true });
                return;
            }

            try
            {
                byte[] bytes = DecodeBase64Data(data);
                File.WriteAllBytes(dlg.FileName, bytes);
                ReplyToJs(reqId, new { ok = true, path = dlg.FileName });
            }
            catch (Exception ex)
            {
                ReplyToJs(reqId, new { ok = false, error = ex.Message });
            }
        });
    }

    // ── Чтение и запись файлов ────────────────────────────────────────────────
    //
    // ВСЕ обращения к диску здесь АСИНХРОННЫЕ (ReadAllTextAsync / WriteAllTextAsync).
    // Раньше стояли обычные File.ReadAllText и File.WriteAllText, а вызываются
    // они из обработчика сообщений — то есть прямо в потоке ОКНА. Пока диск
    // отвечал, окно не перерисовывалось и не принимало нажатия: снаружи это
    // выглядело как зависшая программа. На руднике это происходит регулярно:
    // схемы лежат на сетевой папке, а жёсткий диск после простоя «просыпается»
    // несколько секунд. Теперь ожидание диска идёт в фоне — окно живое, а
    // ответ уходит интерфейсу по готовности (ReplyToJs сам возвращается в
    // поток окна).

    private async Task HandleReadFile(JsonElement root)
    {
        string path  = root.TryGetProperty("path",  out var p) ? p.GetString() ?? "" : "";
        string reqId = root.TryGetProperty("reqId", out var r) ? r.GetString() ?? "" : "";
        try
        {
            string content = await File.ReadAllTextAsync(path, Encoding.UTF8);
            ReplyToJs(reqId, new { path, content });
        }
        catch (Exception ex) { ReplyToJs(reqId, new { error = ex.Message }); }
    }

    private async Task HandleWriteFile(JsonElement root)
    {
        string path    = root.TryGetProperty("path",    out var p) ? p.GetString() ?? "" : "";
        string content = root.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
        string reqId   = root.TryGetProperty("reqId",   out var r) ? r.GetString() ?? "" : "";
        try
        {
            await File.WriteAllTextAsync(path, content, Encoding.UTF8);
            ReplyToJs(reqId, new { ok = true });
        }
        catch (Exception ex) { ReplyToJs(reqId, new { error = ex.Message }); }
    }

    private async Task HandleGetPendingFile(JsonElement root)
    {
        string reqId = root.TryGetProperty("reqId", out var r) ? r.GetString() ?? "" : "";

        // Путь забираем СРАЗУ и обнуляем поле до чтения. Иначе повторный запрос
        // (перезагрузка страницы в момент чтения) прочитал бы файл второй раз и
        // открыл бы его дважды.
        string? pending = _pendingFile;
        _pendingFile = null;

        if (pending == null)
        {
            ReplyToJs(reqId, (object?)null);
            return;
        }

        // Отдельная НЕ-обнуляемая копия: внутри лямбды анализатор не помнит
        // проверку выше и ругался бы на возможный null.
        string path = pending;

        try
        {
            // Чтение обычно уже идёт (или закончилось) с самого старта — тогда
            // здесь ждать нечего. Если задачи нет (страницу перезагрузили),
            // читаем как раньше, в фоне.
            var read = _pendingRead ?? Task.Run(() => ReadPendingFile(path));
            _pendingRead = null;
            ReplyToJs(reqId, await read);
        }
        catch (Exception ex) { ReplyToJs(reqId, new { error = ex.Message }); }
    }

    /// <summary>
    /// Читает файл схемы с диска. Вынесено отдельно, чтобы одно и то же чтение
    /// можно было запустить заранее (на старте) и переиспользовать, когда
    /// интерфейс наконец спросит содержимое.
    /// </summary>
    private static object? ReadPendingFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            string content = File.ReadAllText(path, Encoding.UTF8);
            return new { path, content };
        }
        catch (Exception ex) { return new { error = ex.Message }; }
    }

    // ── Печать ────────────────────────────────────────────────────────────────
    // Веб-страница принципиально не имеет доступа к принтерам операционной
    // системы — браузер это запрещает, поэтому в вебе печать идёт только через
    // системное окно, где инженер ВТОРОЙ раз выбирает принтер и формат, уже
    // заданные в диалоге предпросмотра. В десктопной оболочке ограничения нет:
    // здесь мы отдаём странице список принтеров Windows и печатаем напрямую.
    // Веб-половина моста — src/lib/desktopPrint.ts.

    /// <summary>Список принтеров Windows для выпадающего списка в диалоге печати.</summary>
    private void HandleListPrinters(JsonElement root)
    {
        string reqId = root.TryGetProperty("reqId", out var r) ? r.GetString() ?? "" : "";
        try
        {
            // System.Printing (сборка ReachFramework) входит в WPF — новых
            // пакетов в csproj не требуется.
            using var server = new System.Printing.LocalPrintServer();
            string def = "";
            try { def = server.DefaultPrintQueue?.FullName ?? ""; } catch { /* принтера по умолчанию нет */ }

            var list = new System.Collections.Generic.List<object>();
            foreach (var q in server.GetPrintQueues())
            {
                string name = q.FullName;
                list.Add(new { name, isDefault = string.Equals(name, def, StringComparison.OrdinalIgnoreCase) });
                q.Dispose();
            }
            ReplyToJs(reqId, new { printers = list });
        }
        catch (Exception ex)
        {
            // Пустой список — диалог печати покажет обычное системное окно.
            ReplyToJs(reqId, new { printers = Array.Empty<object>(), error = ex.Message });
        }
    }

    /// <summary>
    /// Печатает готовый HTML напрямую на выбранный принтер, без системного окна.
    /// Документ рисуется в скрытом WebView2, затем уходит на принтер через
    /// PrintAsync с явными параметрами листа.
    /// </summary>
    private async Task HandlePrintHtml(JsonElement root)
    {
        string reqId = root.TryGetProperty("reqId", out var r) ? r.GetString() ?? "" : "";
        string html        = root.TryGetProperty("html", out var h) ? h.GetString() ?? "" : "";
        string printerName = root.TryGetProperty("printerName", out var p) ? p.GetString() ?? "" : "";
        int    copies      = root.TryGetProperty("copies", out var c) && c.TryGetInt32(out int ci) ? ci : 1;
        double wMm         = root.TryGetProperty("paperWidthMm", out var pw) ? pw.GetDouble() : 210;
        double hMm         = root.TryGetProperty("paperHeightMm", out var ph) ? ph.GetDouble() : 297;
        bool   landscape   = root.TryGetProperty("landscape", out var ls) && ls.GetBoolean();

        if (string.IsNullOrEmpty(html)) { ReplyToJs(reqId, new { ok = false, error = "пустой документ" }); return; }

        CoreWebView2Controller? controller = null;
        try
        {
            // Отдельный скрытый WebView2 — печатать основное окно нельзя:
            // на принтер ушёл бы интерфейс программы, а не листы схемы.
            string cacheDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PVS", "WebView2Cache");
            var env = await CoreWebView2Environment.CreateAsync(null, cacheDir);
            IntPtr hwnd = new WindowInteropHelper(this).Handle;
            controller = await env.CreateCoreWebView2ControllerAsync(hwnd);
            controller.IsVisible = false;
            // Размер задаём: при нулевом окне вёрстка листа считается неверно.
            controller.Bounds = new System.Drawing.Rectangle(0, 0, 1200, 900);

            var core = controller.CoreWebView2;

            // Ждём, пока документ полностью отрисуется. Лист A3 при 300 dpi —
            // это десятки мегабайт картинки, она декодируется не мгновенно;
            // печать неготовой страницы дала бы пустой лист.
            var loaded = new TaskCompletionSource<bool>();
            void OnDone(object? s, CoreWebView2NavigationCompletedEventArgs e) => loaded.TrySetResult(e.IsSuccess);
            core.NavigationCompleted += OnDone;
            core.NavigateToString(html);
            // Страховка по времени — программа не должна зависнуть навсегда.
            await Task.WhenAny(loaded.Task, Task.Delay(TimeSpan.FromMinutes(2)));
            core.NavigationCompleted -= OnDone;
            // Даём кадр на раскладку страниц после декодирования картинок.
            await Task.Delay(400);

            var settings = env.CreatePrintSettings();
            if (!string.IsNullOrWhiteSpace(printerName)) settings.PrinterName = printerName;
            settings.Copies      = Math.Max(1, Math.Min(99, copies));
            settings.Orientation = landscape
                ? CoreWebView2PrintOrientation.Landscape
                : CoreWebView2PrintOrientation.Portrait;
            // WebView2 задаёт размеры листа в ДЮЙМАХ, у нас миллиметры.
            settings.PageWidth  = wMm / 25.4;
            settings.PageHeight = hMm / 25.4;
            // Поля уже заложены в сам документ (@page margin:0) — иначе они
            // применились бы дважды и схема съехала бы с листа.
            settings.MarginTop = settings.MarginBottom = 0;
            settings.MarginLeft = settings.MarginRight = 0;
            // Заливки и цветные обозначения обязаны попасть на бумагу.
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;

            var status = await core.PrintAsync(settings);
            bool ok = status == CoreWebView2PrintStatus.Succeeded;
            ReplyToJs(reqId, ok
                ? new { ok = true, error = "" }
                : new { ok = false, error = status.ToString() });
        }
        catch (Exception ex)
        {
            // Любая ошибка — веб-часть сама напечатает обычным способом,
            // через системное окно. Инженер в любом случае получит распечатку.
            ReplyToJs(reqId, new { ok = false, error = ex.Message });
        }
        finally
        {
            try { controller?.Close(); } catch { /* окно уже закрыто */ }
        }
    }

    // ── Обновление ────────────────────────────────────────────────────────────

    private async Task<UpdateInfo?> CheckForUpdateAsync()
    {
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Get, VersionCheckUrl);
            req.Headers.Add("User-Agent", $"PVS/{AppVersion}");
            var resp = await Http.SendAsync(req);
            string json = await resp.Content.ReadAsStringAsync();
            if (string.IsNullOrWhiteSpace(json) || !json.TrimStart().StartsWith("{")) return null;
            var data = JsonSerializer.Deserialize<UpdateInfo>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            // Порог безопасности проверяем ОТДЕЛЬНО от обычного обновления:
            // если текущая сборка ниже минимальной безопасной, данные нужны
            // всегда — даже когда обычный баннер показывать не полагается.
            if (data != null && IsSecurityUpdateRequired(data.MinSecureVersion))
            {
                _securityUpdateRequired = true;
                return data;
            }
            // Баннер показываем ТОЛЬКО если серверная версия СТРОГО НОВЕЕ текущей.
            // Раньше сравнивали строки на "!=" — из-за чего баннер вылезал даже
            // когда установлена та же или более свежая версия.
            if (data?.Version != null && IsNewerVersion(data.Version, AppVersion))
                return data;
        }
        catch { }
        return null;
    }

    // Возвращает true, если candidate строго новее current (семантическое
    // сравнение по номерам: 2.3.29 vs 2.3.30). При неразборчивом формате —
    // безопасный фолбэк: считаем НЕ новее, чтобы не показывать лишний баннер.
    private static bool IsNewerVersion(string candidate, string current)
    {
        static int[] Parse(string v)
        {
            var core = v.Split('+', '-')[0].Trim().TrimStart('v', 'V');
            var parts = core.Split('.');
            var nums = new int[Math.Max(parts.Length, 3)];
            for (int i = 0; i < parts.Length; i++)
                int.TryParse(parts[i], out nums[i]);
            return nums;
        }
        try
        {
            var a = Parse(candidate);
            var b = Parse(current);
            int len = Math.Max(a.Length, b.Length);
            for (int i = 0; i < len; i++)
            {
                int ai = i < a.Length ? a[i] : 0;
                int bi = i < b.Length ? b[i] : 0;
                if (ai != bi) return ai > bi;
            }
            return false; // версии равны
        }
        catch { return false; }
    }

    // Требуется ли ОБЯЗАТЕЛЬНОЕ обновление по безопасности: текущая сборка
    // ниже минимальной безопасной, заданной администратором. Пустой порог —
    // требования нет (обычный режим).
    private static bool IsSecurityUpdateRequired(string? minSecure)
    {
        if (string.IsNullOrWhiteSpace(minSecure)) return false;
        return IsNewerVersion(minSecure!, AppVersion);
    }

    // Блокирующее окно: работать на уязвимой сборке нельзя. Кнопка одна —
    // «Обновить». Отказ от обновления закрывает программу, чтобы человек не
    // продолжал работу на небезопасной версии.
    private void ShowSecurityUpdateDialog()
    {
        string latest = _updateInfo?.Version ?? "";
        string why    = _updateInfo?.SecurityNotes ?? "";

        string text =
            "В вашей версии программы обнаружена и устранена уязвимость.\n" +
            "Чтобы продолжить работу, установите защищённую версию.\n\n" +
            $"Установлена:  {AppVersion}\n" +
            (string.IsNullOrWhiteSpace(latest) ? "" : $"Безопасная:   {latest}\n") +
            (string.IsNullOrWhiteSpace(why) ? "" : $"\n{why}\n") +
            "\nОбновить сейчас?\n\n" +
            "Программа скачает обновление и перезапустится.\n" +
            "Без обновления работа невозможна.";

        var answer = MessageBox.Show(this, text, "Требуется обновление безопасности",
            MessageBoxButton.OKCancel, MessageBoxImage.Warning, MessageBoxResult.OK);

        if (answer == MessageBoxResult.OK)
        {
            _ = HandleInstallUpdate();
        }
        else
        {
            // Пользователь отказался — на уязвимой сборке работать нельзя.
            StopServerForUpdate();
            Application.Current.Shutdown();
        }
    }

    private async Task HandleInstallUpdate()
    {
        // Сервер отдаёт УСТАНОВЩИК (Inno Setup, PVS-Setup-*.exe), а не голый
        // PVS.exe. Программа установлена в C:\Program Files\PVS (нужны права
        // администратора). Поэтому НЕЛЬЗЯ подменять exe на месте — вместо этого
        // скачиваем установщик во временную папку (туда доступ есть всегда) и
        // запускаем его: Windows покажет UAC, установщик корректно обновит всё.

        // Ссылка на установщик. Если пусто — серверный редирект ?file=exe.
        string downloadUrl = string.IsNullOrWhiteSpace(_updateInfo?.DownloadUrl)
            ? $"{VersionCheckUrl}?file=exe"
            : _updateInfo!.DownloadUrl!;
        try
        {
            string ver     = _updateInfo?.Version ?? "latest";
            string setup   = Path.Combine(Path.GetTempPath(), $"PVS-Setup-{ver}.exe");

            // Установщик ~82 МБ — качаем ПОТОКОВО и сообщаем прогресс в JS
            // (window.__pvsUpdateProgress), чтобы в баннере была полоса загрузки.
            using (var httpLarge = new HttpClient { Timeout = TimeSpan.FromMinutes(10) })
            {
                using var resp = await httpLarge.GetAsync(
                    downloadUrl, HttpCompletionOption.ResponseHeadersRead);
                resp.EnsureSuccessStatusCode();
                long total = resp.Content.Headers.ContentLength ?? -1L;

                using var stream = await resp.Content.ReadAsStreamAsync();
                using var file   = File.Create(setup);
                var buffer = new byte[81920];
                long read  = 0;
                int  last  = -1;
                int  n;

                // Скорость закачки. На руднике связь узкая и рваная, поэтому
                // мгновенная скорость скачет — считаем сглаженную (EMA) по
                // окну ~0,5 с: так цифра читаемая, а не мельтешит.
                var swAll   = System.Diagnostics.Stopwatch.StartNew();
                var swTick  = System.Diagnostics.Stopwatch.StartNew();
                long tickBytes = 0;
                double bps = 0;

                while ((n = await stream.ReadAsync(buffer)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, n));
                    read += n;
                    tickBytes += n;

                    if (swTick.ElapsedMilliseconds >= 500)
                    {
                        double inst = tickBytes * 1000.0 / swTick.ElapsedMilliseconds;
                        // Первое измерение принимаем как есть, дальше сглаживаем.
                        bps = bps <= 0 ? inst : bps * 0.7 + inst * 0.3;
                        tickBytes = 0;
                        swTick.Restart();
                    }

                    int pct;
                    if (total > 0)
                    {
                        pct = (int)(read * 100 / total);
                    }
                    else
                    {
                        // Сервер не сообщил размер файла (нет Content-Length) —
                        // процент посчитать не из чего. Раньше в этом случае не
                        // слалось НИЧЕГО и полоса загрузки стояла на нуле всё
                        // скачивание. Оцениваем по типовому размеру установщика
                        // (~82 МБ) и держим до 99%, чтобы полоса двигалась.
                        pct = (int)Math.Min(99, read * 100 / (82L * 1024 * 1024));
                    }
                    if (pct != last)
                    {
                        last = pct;
                        // Средняя скорость за всю закачку — запасной вариант,
                        // если окно ещё не набралось (первые доли секунды).
                        double avg = swAll.Elapsed.TotalSeconds > 0.2
                            ? read / swAll.Elapsed.TotalSeconds : 0;
                        ReportUpdateProgress(pct, read, total, bps > 0 ? bps : avg);
                    }
                }
                ReportUpdateProgress(100, read, total > 0 ? total : read, 0);
            }

            // ВАЖНО: перед запуском установщика ОСТАНАВЛИВАЕМ расчётное ядро.
            // ПОЧЕМУ. Ядро server.exe — отдельный процесс, запущенный нами.
            // Раньше мы закрывали только само приложение (Shutdown), а ядро
            // продолжало работать, держа файл server\server.exe открытым.
            // Установщик не мог его заменить и показывал ошибку
            // «DeleteFile: сбой; код 5. Отказано в доступе».
            // Флаг /CLOSEAPPLICATIONS тут не спасает: Restart Manager видит
            // только окна приложений, а ядро работает без окна (CreateNoWindow),
            // поэтому оно оставалось незамеченным. Закрываем его сами и ждём,
            // пока Windows освободит файл.
            StopServerForUpdate();

            // Запускаем установщик с элевацией (UseShellExecute + runas → UAC).
            // /SILENT — минимум окон; /CLOSEAPPLICATIONS — закрыть текущее
            // приложение перед заменой файлов; RESTARTAPPLICATIONS — перезапуск.
            var psi = new ProcessStartInfo(setup)
            {
                UseShellExecute = true,
                Verb            = "runas",
                Arguments       = "/SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS",
            };
            Process.Start(psi);
            Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            // Сообщаем интерфейсу, что обновление НЕ состоялось: иначе окно
            // «О программе» навсегда осталось бы с надписью «Установка и
            // перезапуск…», хотя ничего уже не происходит. −1 = отмена/ошибка.
            ReportUpdateProgress(-1);

            // Код 1223 = пользователь отклонил UAC-запрос прав администратора.
            if (ex is System.ComponentModel.Win32Exception w32 && w32.NativeErrorCode == 1223)
                return;
            MessageBox.Show($"Ошибка обновления: {ex.Message}", "ПВ-Система",
                            MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    // ── Утилиты ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Отправляет интерфейсу ответ на его запрос.
    ///
    /// ПОЧЕМУ PostWebMessageAsJson, А НЕ ExecuteScriptAsync.
    /// Раньше ответ склеивался в СТРОКУ КОДА («__pvsCsReply("id", {...})») и
    /// отдавался в ExecuteScriptAsync. Для схемы рудника это означало, что
    /// файл на 10–30 МБ превращался в 10–30-мегабайтную ПРОГРАММУ, которую
    /// движок браузера обязан разобрать как исходный текст JavaScript. Разбор
    /// кода в разы дороже разбора данных, а на больших файлах вызов попросту
    /// срывался: ответ не приходил, ожидание в интерфейсе не завершалось
    /// никогда — окно открыто, а схема не появляется. Это и было «иногда
    /// зависает при открытии файла».
    ///
    /// PostWebMessageAsJson передаёт РОВНО ДАННЫЕ: разбирается уже готовый
    /// JSON, кода в нём нет. Попутно уходит и вторая, более коварная беда —
    /// содержимое файла больше не попадает в текст программы, поэтому кавычки,
    /// переводы строк и последовательности вида «</script>» внутри названий
    /// выработок не могут сломать разбор.
    ///
    /// Формат сообщения: { "__pvsReply": "<reqId>", "payload": ... } —
    /// «конверт», который в интерфейсе разбирает обработчик из BuildJsBootstrap.
    /// </summary>
    private void ReplyToJs(string reqId, object? payload)
    {
        // Отправка обязана идти в потоке окна: WebView2 вызов из чужого потока
        // не принимает. Асинхронное чтение файла продолжается в фоне, поэтому
        // сюда мы попадаем уже НЕ из потока окна — возвращаемся в него сами.
        void Send()
        {
            try
            {
                if (WebView?.CoreWebView2 == null) return;
                string json = JsonSerializer.Serialize(new
                {
                    __pvsReply = reqId,
                    payload    = payload,
                });
                WebView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch { /* окно закрывается — отвечать уже некому */ }
        }

        if (Dispatcher.CheckAccess()) Send();
        else Dispatcher.InvokeAsync(Send);
    }

    /// <summary>
    /// Сообщает интерфейсу ход скачивания обновления.
    ///
    /// percent — 0..100, либо −1 = обновление отменено/сорвалось.
    /// Вторым аргументом идут подробности {loaded, total, speed} в БАЙТАХ и
    /// байтах/с: по ним экран «О программе» показывает скорость и оставшееся
    /// время. На руднике связь узкая, и без этих цифр непонятно, идёт ли
    /// закачка вообще или программа зависла.
    ///
    /// Старые сборки веб-части принимают только первый аргумент и просто
    /// игнорируют второй — совместимость сохраняется.
    /// </summary>
    private void ReportUpdateProgress(int percent, long loaded = 0,
                                      long total = 0, double speed = 0)
    {
        try
        {
            Dispatcher.Invoke(() =>
            {
                if (WebView?.CoreWebView2 == null) return;
                string det = JsonSerializer.Serialize(new
                {
                    loaded,
                    total = total > 0 ? total : 0,
                    speed = (long)Math.Max(0, speed),
                });
                _ = WebView.CoreWebView2.ExecuteScriptAsync(
                    $"window.__pvsUpdateProgress && window.__pvsUpdateProgress({percent}, {det});");
            });
        }
        catch { /* окно закрывается — прогресс уже не нужен */ }
    }

    private static byte[] DecodeBase64Data(string data)
    {
        if (data.StartsWith("data:"))
            data = data[(data.IndexOf(',') + 1)..];
        return Convert.FromBase64String(data);
    }

    private void SetStatus(string text) =>
        Dispatcher.Invoke(() => SplashStatus.Text = text);

    private void OnClosed(object? sender, EventArgs e)
    {
        try { _serverProcess?.Kill(entireProcessTree: true); } catch { }
    }

    /// <summary>
    /// Останавливает расчётное ядро (server.exe) перед установкой обновления и
    /// дожидается, пока Windows освободит файл.
    ///
    /// Без этого установщик падает с ошибкой «Отказано в доступе» при попытке
    /// заменить server\server.exe — файл держит работающий процесс ядра.
    /// Дополнительно снимаем ядра, оставшиеся от прошлых запусков (например,
    /// если приложение раньше завершилось аварийно и процесс осиротел).
    /// </summary>
    private void StopServerForUpdate()
    {
        // 1) Наш собственный процесс ядра — со всем деревом дочерних.
        try { _serverProcess?.Kill(entireProcessTree: true); } catch { }
        try { _serverProcess?.WaitForExit(5000); } catch { }

        // 2) «Осиротевшие» ядра из нашей папки установки. Сравниваем путь,
        //    чтобы не задеть чужие процессы с тем же именем.
        string ourDir = AppDomain.CurrentDomain.BaseDirectory;
        foreach (var proc in Process.GetProcessesByName("server"))
        {
            try
            {
                string? exePath = proc.MainModule?.FileName;
                if (exePath != null &&
                    exePath.StartsWith(ourDir, StringComparison.OrdinalIgnoreCase))
                {
                    proc.Kill(entireProcessTree: true);
                    proc.WaitForExit(5000);
                }
            }
            catch { /* нет доступа к чужому процессу — пропускаем */ }
            finally { try { proc.Dispose(); } catch { } }
        }

        // 3) Ждём, пока файл реально освободится: Windows снимает блокировку
        //    не мгновенно. Пробуем открыть на запись — до 3 секунд.
        string serverExe = Path.Combine(ourDir, "server", "server.exe");
        for (int i = 0; i < 30; i++)
        {
            if (!File.Exists(serverExe)) break;
            try
            {
                using var fs = File.Open(serverExe, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                break; // файл свободен — можно обновляться
            }
            catch { Thread.Sleep(100); }
        }
    }

    // ── JS-bootstrap (вставляется после загрузки страницы) ───────────────────

    private string BuildJsBootstrap()
    {
        // camelCase — чтобы JS видел upd.version / upd.downloadUrl (не Version/DownloadUrl)
        var jsOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        string updateJson  = _updateInfo != null ? JsonSerializer.Serialize(_updateInfo, jsOpts) : "null";
        // Путь к открываемому файлу сюда НЕ подставляется: содержимое едет
        // отдельным сообщением по запросу из раннего бутстрапа.
        string isMaxStr    = WindowState == WindowState.Maximized ? "true" : "false";

        return $$"""
(function() {
    // ── Флаг десктопного режима (дублируем на случай перезагрузки страницы) ──
    window.__IS_DESKTOP__       = true;
    window.__DESKTOP_SERVER__   = '{{ServerUrl}}';
    window.__pvsWindowMaximized = {{isMaxStr}};
    // Версия контракта прямой печати (см. src/lib/desktopPrint.ts). Только по
    // этому флагу диалог печати понимает, что доступна печать БЕЗ системного
    // окна: он запрашивает список принтеров Windows и печатает напрямую.
    // На старых сборках флага нет — веб-часть откатывается на печать через
    // окно браузера, поэтому программа не ломается.
    window.__PVS_PRINT_API__    = 1;
    // Окно обязательного обновления показывает сама оболочка — веб-часть
    // своё окно не выводит, чтобы не дублировать требование.
    window.__PVS_SECURITY_GATE__ = 1;

    // ── Реестр незавершённых запросов к ядру программы ──
    //
    // Ответ приходит СООБЩЕНИЕМ (PostWebMessageAsJson), а не выполнением кода:
    // так содержимое файла на десятки мегабайт разбирается как данные, а не как
    // текст программы. Разбор кода такого размера или тянулся минуты, или
    // срывался вовсе — и тогда ожидание не завершалось никогда.
    // Реестр живёт на window, а НЕ в замыкании этого скрипта. Скрипт выполняется
    // заново после каждой перезагрузки страницы, а слушатель сообщений ставится
    // один раз: с реестром внутри замыкания слушатель остался бы привязан к
    // ПЕРВОМУ реестру, и все последующие запросы никогда бы не получили ответ.
    window.__pvsPending = window.__pvsPending || {};
    var _pending = window.__pvsPending;

    // Приём ответов. Конверт от C#: { __pvsReply: "<id>", payload: ... }.
    // Чужие сообщения (прогресс обновления и прочее) пропускаем мимо.
    //
    // ВАЖНО: ответ всегда отдаём через window.__pvsCsReply, а не разбираем
    // реестр здесь же. Диалог печати (src/lib/desktopPrint.ts) ПОДМЕНЯЕТ
    // __pvsCsReply своей обёрткой, чтобы поймать ответ на собственный запрос, и
    // передаёт чужие ответы дальше по цепочке. Разбери мы реестр напрямую —
    // обёртка печати никогда бы не вызвалась, и прямая печать на принтер
    // перестала бы отвечать.
    if (!window.__pvsReplyHooked) {
        window.__pvsReplyHooked = true;
        window.chrome.webview.addEventListener('message', function(e) {
            var d = e.data;
            if (!d || typeof d !== 'object' || typeof d.__pvsReply !== 'string') return;
            if (window.__pvsCsReply) window.__pvsCsReply(d.__pvsReply, d.payload);
        });
    }

    // Разбор ответа: находим ожидающий запрос и завершаем его. Эту же функцию
    // зовёт цепочка подмен из диалога печати, поэтому она объявлена на window.
    //
    // Ранний бутстрап ставит такую же функцию и тот же слушатель (они нужны
    // ему, чтобы запросить схему ещё до загрузки страницы). Реестр общий —
    // window.__pvsPending, — поэтому переопределение здесь безопасно: запрос,
    // отправленный до загрузки, будет завершён этой версией функции.
    window.__pvsCsReply = function(reqId, payload) {
        var reg = window.__pvsPending || {};
        var p = reg[reqId];
        if (!p) return;                 // ответ опоздал: истёк срок ожидания
        delete reg[reqId];
        clearTimeout(p.timer);
        p.resolve(payload);
    };

    // Сколько ждать ответ ядра, миллисекунды. Разное по командам: чтение или
    // запись файла со сетевого диска — это секунды, а печать листа A1 и
    // установка обновления идут заметно дольше, обрывать их нельзя.
    var CS_TIMEOUTS = {
        'read-file':        20000,
        'write-file':       20000,
        'get-pending-file': 20000,
        'save-file':        0,       // 0 = без срока: человек думает в диалоге
        'print-html':       0,       // печать большого листа — минуты
        'install-update':   0,       // скачивание по узкой связи — минуты
        'list-printers':    10000
    };
    var CS_TIMEOUT_DEFAULT = 15000;

    function callCs(cmd, params) {
        return new Promise(function(resolve) {
            var id = Math.random().toString(36).slice(2);
            var ms = CS_TIMEOUTS[cmd];
            if (ms === undefined) ms = CS_TIMEOUT_DEFAULT;

            // СРОК ОЖИДАНИЯ. Раньше его не было совсем: любой сбой в ядре
            // оставлял программу ждать вечно, без единого сообщения — снаружи
            // это выглядело как наглухо зависшее окно. Теперь по истечении
            // срока ожидание завершается понятной ошибкой, и интерфейс может
            // показать её или пойти другим путём (например, открыть файл
            // обычным окном выбора).
            var timer = 0;
            if (ms > 0) {
                timer = setTimeout(function() {
                    if (!_pending[id]) return;
                    delete _pending[id];
                    resolve({ error: 'Ядро программы не ответило за ' + Math.round(ms / 1000) +
                                     ' с (команда «' + cmd + '»). Попробуйте повторить.',
                              timeout: true });
                }, ms);
            }
            _pending[id] = { resolve: resolve, timer: timer };

            try {
                window.chrome.webview.postMessage(JSON.stringify(Object.assign({ cmd: cmd, reqId: id }, params || {})));
            } catch (err) {
                // Мост недоступен — отвечаем сразу, а не ждём истечения срока.
                delete _pending[id];
                clearTimeout(timer);
                resolve({ error: 'Нет связи с ядром программы: ' + (err && err.message ? err.message : err) });
            }
        });
    }
    // Без reqId (fire-and-forget)
    function sendCs(cmd, params) {
        window.chrome.webview.postMessage(JSON.stringify(Object.assign({ cmd: cmd }, params || {})));
    }

    // ── electronAPI совместимость ────────────────
    window.electronAPI = {
        onOpenFile:    function(handler) {
            window._pvs_open_handler = handler;
            // Берём результат запроса, отправленного ЕЩЁ ДО загрузки страницы
            // (см. BuildEarlyBootstrap). К этому моменту файл обычно уже
            // прочитан — схема появляется сразу, без второго похода на диск.
            var pending = window.__pvsPendingFilePromise || callCs('get-pending-file', {});
            window.__pvsPendingFilePromise = null;
            pending.then(function(r) {
                if (r && r.content) { handler({ path: r.path, content: r.content }); return; }
                // Файл не прочитался (нет доступа, сетевой диск отвалился,
                // истёк срок ожидания). Раньше такой случай не показывался
                // никак: открывался пустой проект, и человек не понимал,
                // почему схема не появилась.
                if (r && r.error) {
                    try { console.error('[PVS] Не удалось открыть файл: ' + r.error); } catch (e) {}
                    if (window.__pvsOnOpenFileError) window.__pvsOnOpenFileError(r.error);
                    else alert('Не удалось открыть файл.\n\n' + r.error);
                }
            });
        },
        offOpenFile:   function() { window._pvs_open_handler = null; },
        readFile:      function(path)    { return callCs('read-file',   { path: path }); },
        writeFile:     function(path, c) { return callCs('write-file',  { path: path, content: c }); },
        getVersion:    function()        { return Promise.resolve({ current: '{{AppVersion}}', update: {{updateJson}} }); },
        installUpdate: function()        { return callCs('install-update', {}); }
    };

    // ── Кнопки управления окном ──────────────────
    // Переопределяем обработчики — работают через C# сообщения
    window.__pvsWinMinimize = function() { sendCs('win-minimize'); };
    window.__pvsWinMaximize = function() { sendCs('win-maximize'); };
    window.__pvsWinDrag     = function() { sendCs('win-drag'); };
    // Кнопка закрыть — JS сам показывает диалог если есть несохранённые данные,
    // затем при подтверждении шлёт 'win-close' (JS уже отработал)
    window.__pvsWinClose = function() { sendCs('win-close'); };
    // C# вызывает __pvsShowCloseDialog() когда системная кнопка X нажата
    // React-компонент переопределит эту функцию после загрузки
    window.__pvsShowCloseDialog = function() {
        // Fallback если React ещё не загрузился
        sendCs('win-close-confirmed');
    };

    // ── Перехват <a download> ────────────────────
    function saveViaCs(filename, dataUrl) {
        return callCs('save-file', { filename: filename, data: dataUrl });
    }
    function interceptAnchor(a) {
        if (!a.download) return false;
        var href = a.href || a.getAttribute('href') || '';
        var filename = a.download || 'file';
        if (href.startsWith('data:')) { saveViaCs(filename, href); return true; }
        if (href.startsWith('blob:')) {
            fetch(href).then(function(r) { return r.blob(); }).then(function(blob) {
                var reader = new FileReader();
                reader.onload = function() { saveViaCs(filename, reader.result); };
                reader.readAsDataURL(blob);
            });
            return true;
        }
        return false;
    }
    var _origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        if (interceptAnchor(this)) return;
        _origClick.call(this);
    };
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
        if (a && interceptAnchor(a)) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // ── Перехват jsPDF.save() ────────────────────
    var _jsPdfInterval = setInterval(function() {
        var ns = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (ns && ns.prototype && ns.prototype.save) {
            var _orig = ns.prototype.save;
            ns.prototype.save = function(filename) {
                try { saveViaCs(filename || 'document.pdf', this.output('datauristring')); }
                catch(e) { _orig.call(this, filename); }
            };
            clearInterval(_jsPdfInterval);
        }
    }, 300);

    // ── Перехват XLSX.writeFile ──────────────────
    var _xlsxInterval = setInterval(function() {
        if (typeof XLSX !== 'undefined' && XLSX.writeFile) {
            XLSX.writeFile = function(wb, filename) {
                var ext = (filename.split('.').pop() || 'xlsx');
                var data = XLSX.write(wb, { bookType: ext, type: 'base64' });
                saveViaCs(filename, 'data:application/octet-stream;base64,' + data);
            };
            clearInterval(_xlsxInterval);
        }
    }, 300);

    // ── Баннер обновления ────────────────────────
    // ВАЖНО: собственный баннер здесь БОЛЬШЕ НЕ рисуем — иначе получалось ДВА
    // баннера (этот + React-компонент AppUpdateBanner). Оставляем только React:
    // он показывает версию, прогресс загрузки и кнопки «Обновить»/«Позже».
    // Прогресс скачивания из C# приходит в window.__pvsUpdateProgress(percent).
})();
""";
    }
}

// ── DTO ───────────────────────────────────────────────────────────────────────

public class UpdateInfo
{
    public string? Version { get; set; }

    // Сервер отдаёт поле в snake_case ("download_url") — маппим явно,
    // т.к. PropertyNameCaseInsensitive не превращает snake_case в PascalCase.
    [System.Text.Json.Serialization.JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }

    // Минимальная БЕЗОПАСНАЯ версия. Если текущая сборка ниже — обновление
    // обязательно: оболочка сама покажет блокирующее окно, не полагаясь на
    // веб-часть (в старых сборках интерфейс локальный и окна безопасности
    // в нём просто нет).
    [System.Text.Json.Serialization.JsonPropertyName("min_secure_version")]
    public string? MinSecureVersion { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("security_notes")]
    public string? SecurityNotes { get; set; }
}

public class VersionInfo
{
    public string? Version { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("server_version")]
    public string? ServerVersion { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("server_url")]
    public string? ServerUrl { get; set; }

    // Контроль целостности расчётного ядра при обновлении.
    [System.Text.Json.Serialization.JsonPropertyName("server_sha256")]
    public string? ServerSha256 { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("server_sig")]
    public string? ServerSig { get; set; }

    public string? Notes { get; set; }
}