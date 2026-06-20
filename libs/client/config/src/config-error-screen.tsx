import type {CSSProperties} from 'react';
import type {ConfigKeyError} from './load-config.js';

export interface ConfigErrorScreenProps {
  errors: ConfigKeyError[];
  /** Link to the self-hosting configuration guide. */
  docsUrl?: string;
}

// Self-contained inline styles so the screen renders even when the app's own
// styles or config never loaded. This is a diagnostic surface for self-hosters;
// it must not depend on anything that a misconfiguration could break.
const styles = {
  page: {
    boxSizing: 'border-box',
    minHeight: '100vh',
    margin: 0,
    padding: '48px 24px',
    display: 'flex',
    justifyContent: 'center',
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    color: '#1a1a1a',
    background: '#fafafa',
  },
  card: {
    width: '100%',
    maxWidth: 640,
  },
  title: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 650,
    borderLeft: '3px solid #ff9300',
    paddingLeft: 12,
  },
  intro: {margin: '0 0 24px', lineHeight: 1.5, color: '#444'},
  item: {
    padding: '16px 0',
    borderTop: '1px solid #e5e5e5',
  },
  key: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 14,
    fontWeight: 600,
  },
  description: {margin: '4px 0 8px', lineHeight: 1.5, color: '#444'},
  reason: {margin: 0, fontSize: 14, color: '#b42318'},
  envHint: {margin: '8px 0 0', fontSize: 13, color: '#666'},
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    background: '#f0f0f0',
    borderRadius: 4,
    padding: '1px 5px',
  },
  docs: {marginTop: 24, fontSize: 14},
} satisfies Record<string, CSSProperties>;

/**
 * Full-screen configuration diagnostic shown instead of the app when required
 * config is missing or invalid. It lists every problem at once with the exact
 * environment variable to set, so a self-hoster fixes the deployment in one
 * pass rather than discovering errors one failed request at a time.
 */
export function ConfigErrorScreen({errors, docsUrl}: ConfigErrorScreenProps) {
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Configuration error</h1>
        <p style={styles.intro}>
          The Shipfox client could not start because its configuration is missing or invalid. Set
          the environment variables below and restart the container.
        </p>

        <ul style={{listStyle: 'none', margin: 0, padding: 0}}>
          {errors.map((error) => (
            <li key={error.key} style={styles.item}>
              <div style={styles.key}>{error.key}</div>
              {error.description ? <p style={styles.description}>{error.description}</p> : null}
              <p style={styles.reason}>{error.message}</p>
              <p style={styles.envHint}>
                Set <code style={styles.code}>{error.envVars[0]}</code> (self-hosting) or{' '}
                <code style={styles.code}>{error.envVars[1]}</code> (build time).
              </p>
            </li>
          ))}
        </ul>

        {docsUrl ? (
          <p style={styles.docs}>
            See the <a href={docsUrl}>self-hosting configuration guide</a>.
          </p>
        ) : null}
      </div>
    </main>
  );
}
