import type { Request, Response, NextFunction } from 'express';

export const OPERATOR_HEADER = 'x-operator-key';
// Fixture-only credential. It gates routes by mechanism (401 without it),
// not by secrecy; the synthetic world has nothing worth protecting.
export const OPERATOR_KEY = 'metshield-local-operator';

export function isOperator(req: Request): boolean {
  return req.headers[OPERATOR_HEADER] === OPERATOR_KEY;
}

export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (!isOperator(req)) {
    res.status(401).json({ error: 'operator header required' });
    return;
  }
  next();
}
