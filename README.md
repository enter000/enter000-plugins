# enter000-plugins

Plugins for Claude Code.

```
/plugin marketplace add enter000/enter000-plugins
/plugin install clawd-runner@enter000-plugins
```

## clawd-runner

Two tiny Clawds live above the prompt: they wander, nap, play tag, watch you type and now and then
comment on your work, in the language you write to the agent in.

- `/clawd` hides or shows them
- `/clawd quiet` / `/clawd talk` turns their remarks off or on; each remark is a small model call
- `/clawd stats` shows today's calls and tokens
- `/clawd model <name>` picks the model for their remarks (`haiku`, `sonnet`, a full model id); `/clawd model` shows the current one. Default: `sonnet`. The once-a-turn remark that recalls the whole session runs on the session's own model
- `/clawd <anything else>` is an order to them: "dance", "go to the corners", "come here"
