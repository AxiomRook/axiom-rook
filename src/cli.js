import { loadConfig } from './config.js';
import { DraftWorkflow } from './workflow.js';
import { RedditReader } from './reddit.js';
import { runChatGPTCommand, formatSafeError } from './chatgpt-cli.js';
import { ChatGPTError } from './chatgpt-errors.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command?.startsWith('chatgpt-')) return runChatGPTCommand(command, args);
  const [argument, configPath] = args;
  const config = await loadConfig(configPath);
  if (command === 'demo') {
    const demoConfig = { ...config, allowlistedSubreddits: ['SyntheticDemo'] };
    const flow = new DraftWorkflow(demoConfig);
    const draft = flow.create({ id: 't1_demo', subreddit: 'SyntheticDemo', author: 'ExampleUser', deleted: false, removed: false, locked: false },
      'This is an offline workflow demonstration using synthetic input. No model or Reddit API was called.');
    console.log(JSON.stringify({ mode: 'offline-synthetic-demo', redditApiCalled: false, llmApiCalled: false, draft }, null, 2));
  } else if (command === 'read') {
    const reader = new RedditReader(config, process.env.REDDIT_ACCESS_TOKEN);
    const comments = await reader.readComments(argument);
    // Do not print or persist user content in console logs.
    console.log(JSON.stringify({ fetchedCommentCount: comments.length, contentPersisted: false }));
  } else if (command === 'status') {
    console.log(JSON.stringify({ account: config.account, redditAccessApproved: config.redditAccessApproved, postingImplemented: false, llmImplemented: true, llmManualTestOnly: true, backgroundAutomationEnabled: false, communities: config.allowlistedSubreddits }, null, 2));
  } else throw new Error('Use: node src/cli.js demo | status | read <subreddit> [private-config-path] | chatgpt-login | chatgpt-status | chatgpt-models | chatgpt-model <slug> | chatgpt-test | chatgpt-logout');
}
main().catch(error => {
  // Avoid printing provider responses, headers, credentials or private context.
  console.error(error instanceof ChatGPTError ? formatSafeError(error) : error.message); process.exitCode = 1;
});
