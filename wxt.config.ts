import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Floq — AI Sales Assistant',
    short_name: 'Floq',
    version: '1.3.0',
    version_name: '1.3.0',
    description: 'AI-powered sales execution for dealership reps. Generate texts, emails, and CRM notes in seconds. Command Mode: speak or type commands and Floq does the rest.',
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    commands: {
      'open_command_mode': {
        suggested_key: { default: 'Alt+K' },
        description: 'Open Floq Command Mode'
      }
    },
    permissions: ['activeTab', 'storage'],
    web_accessible_resources: [{
      resources: ['voice.html', 'oper8er-intercept.js'],
      matches: ['*://*.vinsolutions.com/*', '*://*.coxautoinc.com/*', '*://www.facebook.com/*', '*://mail.google.com/*', '*://www.linkedin.com/*']
    }],
    host_permissions: [
      '*://*.vinsolutions.com/*',
      '*://*.coxautoinc.com/*',
      'https://oper8er-proxy-production.up.railway.app/*',
      'https://mqnmemnogbotgmsmqfie.supabase.co/*'
    ],
  },
});
