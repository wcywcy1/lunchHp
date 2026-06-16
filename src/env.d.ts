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
    downloadFile(options: { fileID: string; success?: (res: any) => void; fail?: (err: any) => void }): void
    deleteFile(options: { fileList: string[] }): Promise<any>
  }
  createSelectorQuery(): any
  getWindowInfo(): { pixelRatio: number; screenWidth: number; screenHeight: number; windowWidth: number; windowHeight: number }
  createCanvasContext(canvasId: string): any
  getFileSystemManager(): {
    writeFileSync(filePath: string, data: string, encoding: string): void
    readFileSync(filePath: string, encoding: string): string
    unlinkSync(filePath: string): void
  }
  openDocument(options: { filePath: string; showMenu?: boolean }): void
  showToast(options: { title: string; icon?: string; duration?: number }): void
  setStorageSync(key: string, data: any): void
  getStorageSync(key: string): any
  exitMiniProgram(): void
  env: {
    USER_DATA_PATH: string
  }
}