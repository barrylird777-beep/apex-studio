import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Import our new separated workspaces
import oracleRoute from './routes/oracle.mjs';
import forgeRoute from './routes/forge.mjs';
import bardRoute from './routes/bard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// The Traffic Cop: Direct frontend requests to the correct workspace
app.use('/api/oracle', oracleRoute);
app.use('/api/forge', forgeRoute);
app.use('/api/bard', bardRoute);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Apex Studio Server running smoothly on port ${PORT}`);
    console.log(`All systems modular and online.`);
});
