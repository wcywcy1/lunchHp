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
    uploadFile(options: { cloudPath: string; filePath: string }): Promise<{ fileID: string }>
  }
  createSelectorQuery(): any
  getWindowInfo(): { pixelRatio: number; screenWidth: number; screenHeight: number; windowWidth: number; windowHeight: number }
  createCanvasContext(canvasId: string): any
  getFileSystemManager(): {
    writeFileSync(filePath: string, data: string, encoding: string): void
    readFileSync(filePath: string, encoding: string): string
    readFileSync(filePath: string): ArrayBuffer
    unlinkSync(filePath: string): void
    accessSync(filePath: string): void
    saveFileSync(tempFilePath: string, filePath: string): string
  }
  shareFileMessage(options: { filePath: string; fileName: string; success?: () => void; fail?: (err: any) => void }): void
  openDocument(options: { filePath: string; showMenu?: boolean; success?: () => void; fail?: (err: any) => void }): void
  chooseMessageFile(options: { count: number; type?: 'all' | 'video' | 'image' | 'file'; extension?: string[]; success: (res: any) => void; fail?: (err: any) => void }): void
  showToast(options: { title: string; icon?: string; duration?: number }): void
  setStorageSync(key: string, data: any): void
  getStorageSync(key: string): any
  exitMiniProgram(): void
  env: {
    USER_DATA_PATH: string
  }
}