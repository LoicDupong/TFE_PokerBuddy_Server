import express from 'express';
import { apiRouter } from './routers/index.js';
import morgan from 'morgan';

// Variable d'en
const { NODE_ENV, PORT } = process.env;

// WebAPI setup
const app = express();

// Middleware
app.use(morgan('tiny'));
app.use(express.json());

// Routing
app.use('/api', apiRouter);

// Start
app.listen(PORT, (error) => {
    if (error) {
        console.log('Web API on error');
        console.log(error);
        return;
    }

    console.log(`Serveur lancé sur http://localhost:${PORT} (${NODE_ENV})`);
});