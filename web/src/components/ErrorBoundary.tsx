import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { BrandMark } from './BrandMark';

type State = { failed: false } | { failed: true; error: unknown };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const { error } = this.state;
    return (
      <div className="boot-screen" role="alert">
        <BrandMark theme={theme} size="lg" srLabel={false} />
        <div className="error-card boot-error">
          <p>界面加载失败，请重新加载。</p>
          {error instanceof Error && error.message && (
            <details className="boot-error-detail">
              <summary>技术详情</summary>
              <p>{error.message}</p>
            </details>
          )}
        </div>
        <button type="button" className="button primary" onClick={() => window.location.reload()}>
          <RotateCcw size={14} aria-hidden /> 重新加载
        </button>
      </div>
    );
  }
}
