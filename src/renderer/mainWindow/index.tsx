import '@infra/tauriBridge/autoInject';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { applyRuntimePlatformAttr } from '@common/runtimePlatform';
import { bootstrapMainWindowServices, bootstrapMainWindowShell } from '../bootstrap/mainWindow';
import { AppErrorBoundary, renderStartupFailure } from './AppFailure';
import router from './router';

applyRuntimePlatformAttr();
document.body.dataset.window = 'main';

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root element not found');
}

const root = createRoot(container);

function renderErrorFallback(error: unknown) {
    renderStartupFailure((node) => root.render(node), error);
}

window.addEventListener('error', (event) => {
    console.error('[MainWindow Error]', event.error || event.message);
    if (!document.querySelector('#root > *')) {
        renderErrorFallback(event.error || event.message);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[MainWindow UnhandledRejection]', event.reason);
    if (!document.querySelector('#root > *')) {
        renderErrorFallback(event.reason);
    }
});

bootstrapMainWindowShell()
    .then(() => {
        root.render(
            <React.StrictMode>
                <AppErrorBoundary>
                    <RouterProvider router={router} />
                </AppErrorBoundary>
            </React.StrictMode>,
        );
        // 插件、歌单和上次歌曲的音源继续在后台准备，不再挡住第一帧。
        void bootstrapMainWindowServices().catch((err) => {
            console.error('[MainWindow Bootstrap Failed]', err);
        });
    })
    .catch((err) => {
        console.error('[MainWindow Bootstrap Failed]', err);
        renderErrorFallback(err);
    });
