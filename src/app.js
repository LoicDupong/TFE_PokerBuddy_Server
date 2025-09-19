import express from 'express';
import { apiRouter } from './routers/index.js';
import morgan from 'morgan';
import cors from 'cors';
import { authMiddleware } from './middlewares/auth.middleware.js';

// Variable d'en
const { NODE_ENV, PORT } = process.env;

// WebAPI setup
const app = express();

// Middleware
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

// Static files (images, etc.)
app.use('/public', express.static('public'));

// Routing
app.use('/api', authMiddleware(), apiRouter);

// Start
app.listen(PORT, (error) => {
    if (error) {
        console.log('Web API on error');
        console.log(error);
        return;
    }

    console.log(`Serveur lancé sur http://localhost:${PORT} (${NODE_ENV})`);
});