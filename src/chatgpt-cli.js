import { ChatGPTAuth } from './chatgpt-auth.js';
import { ChatGPTClient } from './chatgpt-client.js';
import { ChatGPTError, formatSafeError } from './chatgpt-errors.js';
import { PrivateChatGPTStore, safeStatus } from './chatgpt-store.js';
import { loadVault } from './vault.js';

function loginOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--new-account' && !options.newAccount) options.newAccount = true;
    else if (args[i] === '--enable-plan' && !options.enablePlan) options.enablePlan = true;
    else if (args[i] === '--account' && !options.account && args[i + 1]) options.account = args[++i];
    else throw new ChatGPTError('invalid_config');
  }
  if (options.newAccount && options.account) throw new ChatGPTError('invalid_config');
  return options;
}

export async function runChatGPTCommand(command, args = [], { store = new PrivateChatGPTStore(), authOptions = {}, output = console.log, env = process.env } = {}) {
  const auth = new ChatGPTAuth(store, authOptions), client = new ChatGPTClient(auth);
  try {
    let result;
    if (command === 'chatgpt-login') {
      const options = loginOptions(args);
      output('Continue with ChatGPT for Axiom Rook. This requests identity and eligible plan-use permission.');
      output('Credentials and the verified account mapping stay in your private local user directory. No ChatGPT conversations or personalization are imported.');
      output('Privacy and usage details: docs/chatgpt-plan-sharing.md | Terms: https://openai.com/policies/sign-in-with-chatgpt-terms/');
      result = await auth.login(options);
    } else if (command === 'chatgpt-status' || command === 'chatgpt-accounts') {
      if (args.length) throw new ChatGPTError('invalid_config');
      result = safeStatus(await store.read());
    } else if (command === 'chatgpt-models') {
      if (args.length) throw new ChatGPTError('invalid_config');
      result = { models: await client.models() };
    } else if (command === 'chatgpt-model') {
      if (args.length !== 1) throw new ChatGPTError('model_required');
      result = await client.selectModel(args[0]);
    } else if (command === 'chatgpt-use') {
      if (args.length !== 1) throw new ChatGPTError('invalid_config');
      result = await auth.useAccount(args[0]);
    } else if (command === 'chatgpt-test') {
      let records = [];
      if (args.length) {
        if (args.length !== 2 || args[0] !== '--context-vault') throw new ChatGPTError('invalid_input');
        try { records = await loadVault(args[1], env.AXIOM_VAULT_KEY); } catch { throw new ChatGPTError('invalid_input'); }
      }
      // No Reddit event, scheduled task, webhook or background worker reaches this call.
      result = await client.test({ manual: true, records });
    } else if (command === 'chatgpt-logout') {
      const options = args.length === 2 && args[0] === '--account' ? { account: args[1] } : {};
      if (args.length && !options.account) throw new ChatGPTError('invalid_config');
      result = await auth.logout(options);
    } else throw new ChatGPTError('invalid_config');
    output(JSON.stringify(result, null, 2)); return result;
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError('storage_failure');
  }
}

export { formatSafeError };
