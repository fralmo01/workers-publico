declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

// Permite importar archivos .sql como strings (via plugin Vite en vitest.config.mts)
declare module '*.sql' {
  const content: string;
  export default content;
}
