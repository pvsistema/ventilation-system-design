// ─────────────────────────────────────────────────────────────────────────────
// Публичная страница документации (/docs).
//
// Решает две задачи сразу:
//  1. Отдаёт правообладателю комплект документов для подачи заявления
//     в Единый реестр российского ПО — одним архивом или по частям.
//  2. Служит той самой «страницей сайта с документацией», адрес которой
//     требуется указать в заявлении (шаг 3/13). Эксперт реестра обязан
//     открыть её БЕЗ авторизации, поэтому страница публичная и не требует
//     лицензии.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import { APP_VERSION, APP_BUILD_DATE } from "@/lib/appVersion";

interface DocItem {
  file: string;
  title: string;
  desc: string;
  pages: number;
  /** Обязательный документ для экспертной проверки (шаг 5/13). */
  required?: boolean;
}

const DOCS: DocItem[] = [
  {
    file: "01_ИНСТРУКЦИЯ_ПО_УСТАНОВКЕ.pdf",
    title: "Инструкция по установке",
    desc: "Системные требования, состав дистрибутива, порядок установки и активации, проверка работоспособности, удаление.",
    pages: 6,
    required: true,
  },
  {
    file: "02_ФУНКЦИОНАЛЬНЫЕ_ХАРАКТЕРИСТИКИ.pdf",
    title: "Описание функциональных характеристик",
    desc: "Назначение, область применения и полный перечень расчётных возможностей: воздухораспределение, расход воздуха по ФНиП № 505, пожар, взрыв, ППЗ, ВДС и вентканал ГВУ.",
    pages: 11,
    required: true,
  },
  {
    file: "03_ЖИЗНЕННЫЙ_ЦИКЛ_И_ПОДДЕРЖКА.pdf",
    title: "Процессы жизненного цикла и поддержка",
    desc: "Разработка и выпуск обновлений, устранение неисправностей, техническая поддержка, сведения о персонале.",
    pages: 8,
    required: true,
  },
  {
    file: "04_РУКОВОДСТВО_ПО_ЭКСПЛУАТАЦИИ.pdf",
    title: "Руководство по эксплуатации",
    desc: "Работа с программой по шагам: лицензия, импорт из АэроСети и DXF, построение сети, расчёты, акт устойчивости, вентканал ГВУ, пожар, взрыв, ППЗ, печать.",
    pages: 19,
    required: true,
  },
  {
    file: "09_ТАРИФНАЯ_ПОЛИТИКА.pdf",
    title: "Тарифная политика",
    desc: "Стоимость лицензий: базовая цена за рабочее место, пакет на 5 мест, расчёт лицензии на предприятие.",
    pages: 2,
  },
  {
    file: "05_ТЕХНИЧЕСКАЯ_ДОКУМЕНТАЦИЯ.pdf",
    title: "Техническая документация",
    desc: "Архитектура программы, технологический стек, системные требования, сведения о правообладании.",
    pages: 9,
  },
];

const BASE = "/reestr/";

export default function Docs() {
  const totalPages = DOCS.reduce((s, d) => s + d.pages, 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900"
      style={{ fontFamily: "var(--font-ui)" }}>

      {/* Шапка */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <Icon name="FileText" size={24} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">
                Документация «ПВ-Система»
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Программа для проектирования и расчёта систем вентиляции
                и противопожарного водоснабжения рудников и шахт
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[13px] text-slate-500">
                <span>Версия <b className="text-slate-700">{APP_VERSION}</b></span>
                <span>Сборка от <b className="text-slate-700">{APP_BUILD_DATE}</b></span>
                <span><b className="text-slate-700">{totalPages}</b> страниц документации</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Обязательные документы */}
        <h2 className="text-[15px] font-semibold text-slate-900 mb-1">
          Документы для экспертной проверки
        </h2>
        <p className="text-[13px] text-slate-600 mb-4">
          Описание функциональных характеристик, инструкция по установке и руководство
          по эксплуатации программы. Документы открываются без регистрации.
        </p>

        <div className="space-y-2.5 mb-8">
          {DOCS.filter((d) => d.required).map((d) => (
            <DocCard key={d.file} doc={d} />
          ))}
        </div>

        {/* Сопутствующие */}
        <h2 className="text-[15px] font-semibold text-slate-900 mb-4">
          Сопутствующие документы
        </h2>
        <div className="space-y-2.5 mb-8">
          {DOCS.filter((d) => !d.required).map((d) => (
            <DocCard key={d.file} doc={d} />
          ))}
        </div>

        {/* Пояснение */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-700 leading-relaxed">
          <div className="flex gap-2.5">
            <Icon name="Info" size={17} className="flex-shrink-0 mt-0.5" />
            <div>
              <b>Правообладатель:</b> Ипатов Сергей Генадьевич, ИНН 026706779625.
              Свидетельство о государственной регистрации программы для ЭВМ
              № 2026681414 от 14.07.2026.
              <br />
              <b>Техническая поддержка:</b>{" "}
              <a href="mailto:votapise@mail.ru" className="text-blue-600 hover:underline">votapise@mail.ru</a>,{" "}
              <a href="tel:+79625244698" className="text-blue-600 hover:underline">+7 962 524-46-98</a>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 text-[13px] text-slate-500">
          <a href="/download" className="text-blue-600 hover:underline">
            Скачать программу «ПВ-Система»
          </a>
          <span className="mx-2">·</span>
          <a href="/" className="text-blue-600 hover:underline">
            Открыть программу
          </a>
        </div>
      </div>
    </div>
  );
}

function DocCard({ doc }: { doc: DocItem }) {
  return (
    <a
      href={BASE + doc.file}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3.5 p-4 rounded-lg bg-white border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all group">
      <div className="w-9 h-9 rounded bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon name="FileText" size={18} className="text-red-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[14px] text-slate-900 group-hover:text-blue-700">
            {doc.title}
          </span>
        </div>
        <p className="text-[12.5px] text-slate-600 mt-1 leading-relaxed">{doc.desc}</p>
        <div className="text-[11.5px] text-slate-400 mt-1.5">
          PDF · {doc.pages} стр.
        </div>
      </div>
      <Icon name="ExternalLink" size={16}
        className="flex-shrink-0 text-slate-300 group-hover:text-blue-500 mt-1" />
    </a>
  );
}