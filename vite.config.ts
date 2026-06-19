import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

function copyDir(src: string, dest: string) {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        if (statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function copyWxcloudPlugin() {
    return {
        name: "copy-wxcloud",
        writeBundle(options: any) {
            const outDir = options.dir || "dist/build/mp-weixin";
            const wxcloudSrc = join(process.cwd(), "wxcloud");
            const wxcloudDest = join(outDir, "wxcloud");
            if (existsSync(wxcloudSrc)) {
                copyDir(wxcloudSrc, wxcloudDest);
                console.log("[copy-wxcloud] copied wxcloud ->", wxcloudDest);
            }
        },
    };
}

export default defineConfig({
    plugins: [uni(), copyWxcloudPlugin()],
    css: {
        preprocessorOptions: {
            scss: {
                silenceDeprecations: ['legacy-js-api'],
            },
        },
    },
});