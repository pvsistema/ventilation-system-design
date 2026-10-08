/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес сервера-зеркала. Задаётся только при сборке резервной копии. */
  readonly VITE_API_BASE?: string;
}
