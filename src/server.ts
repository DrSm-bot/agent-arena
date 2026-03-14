import { createApp } from "./app.js";

const { app, context } = createApp();

app.listen(context.config.port, () => {
  console.info(`agent-arena listening on port ${context.config.port}`);
});
