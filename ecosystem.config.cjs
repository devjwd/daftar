module.exports = {
  apps: [
    {
      name: 'daftar-server',
      script: 'node',
      args: '..\\..\\node_modules\\tsx\\dist\\cli.mjs index.ts',
      cwd: 'e:\\Daftar on movement\\daftar\\apps\\server',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'daftar-worker',
      script: 'node',
      args: '..\\..\\node_modules\\tsx\\dist\\cli.mjs worker.ts',
      cwd: 'e:\\Daftar on movement\\daftar\\apps\\server',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'daftar-frontend',
      script: 'npm.cmd',
      args: 'run dev',
      cwd: 'e:\\Daftar on movement\\daftar\\apps\\frontend',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
