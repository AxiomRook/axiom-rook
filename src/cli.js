import { loadConfig } from './config.js';
import { DraftWorkflow } from './workflow.js';
import { RedditReader } from './reddit.js';

async function main() {
  const [command, argument, configPath] = process.argv.slice(2);
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
    console.log(JSON.stringify({ account: config.account, redditAccessApproved: config.redditAccessApproved, postingImplemented: false, llmImplemented: false, communities: config.allowlistedSubreddits }, null, 2));
  } else throw new Error('Use: node src/cli.js demo | status | read <subreddit> [private-config-path]');
}
main().catch(error => {
  // Avoid printing provider responses, headers, credentials or private context.
  console.error(error.message); process.exitCode = 1;
});
