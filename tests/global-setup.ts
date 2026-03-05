import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { exec, type ChildProcess, execSync } from 'child_process';

let pgContainer: StartedTestContainer;
let serverProcess: ChildProcess;

function detectDockerHost(): string | undefined {
  try {
    const info = execSync('docker context inspect --format "{{.Endpoints.docker.Host}}"', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return info || undefined;
  } catch {
    return undefined;
  }
}

export async function setup() {
  // Auto-detect Docker socket from current docker context (supports Rancher Desktop, Colima, etc.)
  if (!process.env.DOCKER_HOST) {
    const host = detectDockerHost();
    if (host) {
      process.env.DOCKER_HOST = host;
    }
  }

  // Disable Ryuk reaper — its log-based wait can fail with some Docker runtimes
  process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';

  // Start Postgres container using GenericContainer to control the wait strategy
  pgContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: 'todo_test',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(60_000)
    .start();

  const pgHost = pgContainer.getHost();
  const pgPort = pgContainer.getMappedPort(5432);
  const databaseUrl = `postgresql://test:test@${pgHost}:${pgPort}/todo_test`;
  const port = '3005';

  // Start the app server as a child process
  serverProcess = exec(`npx tsx src/server.ts`, {
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: port },
    cwd: process.cwd(),
  });

  // Wait for the server to be ready
  await waitForServer(`http://localhost:${port}/api/todos`, 10000);

  // Make these available to tests
  process.env.DATABASE_URL = databaseUrl;
  process.env.PORT = port;
}

export async function teardown() {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (pgContainer) {
    await pgContainer.stop();
  }
}

async function waitForServer(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}
