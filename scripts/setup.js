import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(msg, color = COLORS.reset) {
  console.log(`${color}${msg}${COLORS.reset}`);
}

async function setup() {
  log('🚀 Starting Daftar Development Environment Setup', COLORS.bright + COLORS.magenta);
  
  // 1. Install dependencies
  log('\n📦 Installing project dependencies...', COLORS.cyan);
  try {
    execSync('npm install', { stdio: 'inherit', cwd: PROJECT_ROOT });
    log('✅ Dependencies installed successfully.', COLORS.green);
  } catch (err) {
    log('❌ Failed to install dependencies. Please check your npm installation.', COLORS.red);
    process.exit(1);
  }

  // 2. Setup Environment Files
  const envConfigs = [
    {
      name: 'Server',
      dir: 'apps/server',
      template: '.env.example',
      target: '.env'
    },
    {
      name: 'Frontend',
      dir: 'apps/frontend',
      template: '.env.local', // Frontend often uses .env.local
      target: '.env.local',
      fallbackTemplate: '.env'
    }
  ];

  log('\n🔑 Setting up environment variables...', COLORS.cyan);
  for (const config of envConfigs) {
    const targetPath = path.join(PROJECT_ROOT, config.dir, config.target);
    const templatePath = path.join(PROJECT_ROOT, config.dir, config.template);
    const fallbackPath = config.fallbackTemplate ? path.join(PROJECT_ROOT, config.dir, config.fallbackTemplate) : null;

    if (fs.existsSync(targetPath)) {
      log(`ℹ️  ${config.name} environment file already exists at ${config.dir}/${config.target}`, COLORS.yellow);
    } else {
      const source = fs.existsSync(templatePath) ? templatePath : fallbackPath;
      if (source && fs.existsSync(source)) {
        fs.copyFileSync(source, targetPath);
        log(`✅ Created ${config.name} environment file from template.`, COLORS.green);
      } else {
        log(`⚠️  Warning: Template for ${config.name} not found. Please create ${config.dir}/${config.target} manually.`, COLORS.yellow);
      }
    }
  }

  // 3. Final instructions
  log('\n✨ Setup Complete!', COLORS.bright + COLORS.green);
  log('\nTo start the development environment:', COLORS.bright);
  log('  1. Edit apps/server/.env with your Supabase and Movement credentials.', COLORS.cyan);
  log('  2. Edit apps/frontend/.env.local with your public configuration.', COLORS.cyan);
  log('  3. Run: npm run dev', COLORS.bright + COLORS.magenta);
  
  log('\nTo run the diagnostic tests:', COLORS.bright);
  log('  npm test -- 0xYOUR_WALLET_ADDRESS', COLORS.cyan);
  log('\nHappy Coding! 👩‍💻👨‍💻', COLORS.magenta);
}

setup().catch(err => {
  console.error('Fatal setup error:', err);
  process.exit(1);
});
