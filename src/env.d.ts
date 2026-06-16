/// <reference types="vite/client" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare const wx: {
  cloud: {
    init(options: { env: string; traceUser?: boolean }): void
    callFunction(options: { name: string; data?: Record<string, any> }): Promise<any>
    database(): any
  }
}