export interface MariaDbConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

export function parseMariaDbUrl(databaseUrl: string): MariaDbConnectionOptions {
  const url = new URL(databaseUrl);

  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL debe utilizar el protocolo mysql://.');
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!url.hostname || !url.username || !database) {
    throw new Error('DATABASE_URL debe incluir host, usuario y base de datos.');
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: 10,
  };
}
