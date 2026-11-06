import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
    base: './',
    // 为开发和生产构建提供一致的编译期常量。
    // 缺少该定义时，源码中的 __DEV__ 在生产 WebView 中会抛出 ReferenceError 导致白屏。
    define: {
        __DEV__: JSON.stringify(mode !== 'production'),
    },
    plugins: [react()],
    css: {
        preprocessorOptions: {
            scss: {
                api: 'modern-compiler',
            },
        },
    },
    resolve: {
        alias: {
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@assets': path.resolve(__dirname, 'src/assets'),
            '@common': path.resolve(__dirname, 'src/common'),
            '@infra': path.resolve(__dirname, 'src/infra'),
            '@appTypes': path.resolve(__dirname, 'src/types'),
        },
    },
    server: {
        port: 47321,
        strictPort: true,
        watch: {
            // Cargo 编译时会锁住 src-tauri/target 里的 dll。监视这些文件会在 Windows 上触发 EBUSY 并让 Vite 退出。
            ignored: ['**/src-tauri/**'],
        },
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'mainWindow.html'),
                lyric: path.resolve(__dirname, 'lyricWindow.html'),
                minimode: path.resolve(__dirname, 'minimodeWindow.html'),
                trayMenu: path.resolve(__dirname, 'trayMenuWindow.html'),
            },
        },
    },
}));
