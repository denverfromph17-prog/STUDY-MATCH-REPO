import { createApp } from './app.js';
import { getConfig } from './config.js';
import { createDatabase } from './db.js';

const config = getConfig();
const db = createDatabase(config.databasePath);
const app = createApp({ db, config });
app.listen(config.port, config.host, () => console.log(`Study Match PH is running at http://${config.host}:${config.port}`));
