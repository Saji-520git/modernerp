import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '60vh',
          gap: '1rem',
          fontFamily: 'sans-serif',
          color: '#334155',
        }}>
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: '2rem',
            maxWidth: 480,
            width: '100%',
          }}>
            <p style={{ fontWeight: 500, marginBottom: 8 }}>
              {this.props.fallbackTitle ?? 'Something went wrong'}
            </p>
            <pre style={{
              fontSize: 12,
              background: '#f8fafc',
              padding: '0.75rem',
              borderRadius: 6,
              overflowX: 'auto',
              color: '#dc2626',
            }}>
              {this.state.error.message}
            </pre>
            <button
              onClick={this.handleReset}
              style={{
                marginTop: 16,
                padding: '8px 20px',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                background: 'white',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
