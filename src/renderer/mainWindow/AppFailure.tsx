import { Component, type ErrorInfo, type ReactNode } from 'react';

function FailureScreen({ onRetry }: { onRetry: () => void }) {
    return (
        <div
            style={{
                padding: 32,
                fontFamily: 'Segoe UI, sans-serif',
                background: '#18181b',
                color: '#f4f4f5',
                height: '100vh',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'flex-start',
                gap: 12,
            }}
        >
            <h2 style={{ margin: 0, fontSize: 20 }}>播放器没有打开</h2>
            <p style={{ margin: 0, color: '#a1a1aa' }}>
                可以重新加载。如果还是打不开，再把日志发给开发者。
            </p>
            <button
                type="button"
                style={{
                    marginTop: 8,
                    padding: '8px 16px',
                    borderRadius: 6,
                    background: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                }}
                onClick={onRetry}
            >
                重新加载
            </button>
        </div>
    );
}

export function renderStartupFailure(render: (node: ReactNode) => void, error: unknown): void {
    console.error('[MainWindow Bootstrap Failed]', error);
    render(<FailureScreen onRetry={() => window.location.reload()} />);
}

interface BoundaryState {
    failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
    state: BoundaryState = { failed: false };

    static getDerivedStateFromError(): BoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('[MainWindow Render]', error, info.componentStack);
    }

    render() {
        if (this.state.failed) {
            return <FailureScreen onRetry={() => window.location.reload()} />;
        }
        return this.props.children;
    }
}
