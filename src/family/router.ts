import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import authRouter from './auth.js';
import invitesRouter, { childrenRouter } from './invites.js';
import threadsRouter, { messagesRouter } from './threads.js';
import checkinsRouter from './checkins.js';
import notificationsRouter from './notifications.js';
import reframeRouter from './reframe/index.js';

const router = Router();

// cookie-parser is mounted only on this router — the todo routes never see it.
router.use(cookieParser());

router.use('/auth', authRouter);
router.use('/invites', invitesRouter);
router.use('/children', childrenRouter);
router.use('/threads', threadsRouter);
router.use('/messages', messagesRouter);
router.use('/reframe', reframeRouter);
router.use('/checkins', checkinsRouter);
router.use('/notifications', notificationsRouter);

// Central JSON error handler: any unhandled error from a route (typically
// forwarded via asyncHandler's next(err)) lands here as 500 JSON instead of
// crashing the process or falling through to Express's default HTML page.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('family router error:', err);
  if (res.headersSent) {
    _next(err);
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
};
router.use(errorHandler);

export default router;
