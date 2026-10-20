import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { MANAGER_ROLES, type Language, type Role } from '@mise/contracts';
import { createAuthService, type AuthService } from '../modules/auth/service.js';
import { ApiError } from '../lib/errors.js';

export const SESSION_COOKIE = 'mise_session';
export const DEVICE_COOKIE = 'mise_device';

export interface CurrentUser {
  id: string;
  displayName: string;
  email: string | null;
  role: Role;
  defaultStationId: string | null;
  /** Their own interface language, or null to follow the kitchen. */
  language: Language | null;
  /** Set when the session was started by PIN on an enrolled tablet. */
  deviceId: string | null;
  /** Whether they have been offered the tour of the app yet. */
  tourSeen: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthService;
    /** Rejects the request unless someone is signed in. */
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Rejects the request unless the signed-in user holds one of these roles. */
    requireRole: (
      ...roles: Role[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Rejects the request unless it comes from an enrolled kitchen device. */
    requireDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    setSessionCookie: (reply: FastifyReply, token: string, expiresAt: Date) => void;
    clearSessionCookie: (reply: FastifyReply) => void;
  }

  interface FastifyRequest {
    user: CurrentUser | null;
    deviceId: string | null;
  }
}

/**
 * Every request gets its session resolved up front, so route handlers can read
 * request.user without caring how the person signed in.
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  const auth = createAuthService(app.db);
  app.decorate('auth', auth);
  app.decorateRequest('user', null);
  app.decorateRequest('deviceId', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = await auth.resolveSession(token);
      if (session) {
        request.user = {
          id: session.userId,
          displayName: session.displayName,
          email: session.email,
          role: session.role,
          defaultStationId: session.defaultStationId,
          language: session.language,
          deviceId: session.deviceId,
          tourSeen: session.tourSeenAt !== null,
        };
      }
    }

    const deviceToken = request.cookies[DEVICE_COOKIE];
    if (deviceToken) {
      const device = await auth.resolveDevice(deviceToken);
      request.deviceId = device?.id ?? null;
    }
  });

  app.decorate('requireUser', async (request: FastifyRequest) => {
    if (!request.user) throw new ApiError(401, 'not_authenticated', 'Sign in to continue.');
  });

  app.decorate('requireRole', (...roles: Role[]) => {
    return async (request: FastifyRequest) => {
      if (!request.user) throw new ApiError(401, 'not_authenticated', 'Sign in to continue.');
      if (!roles.includes(request.user.role)) {
        throw new ApiError(403, 'forbidden', 'Your role does not allow that.');
      }
    };
  });

  app.decorate('requireDevice', async (request: FastifyRequest) => {
    if (!request.deviceId) {
      throw new ApiError(
        403,
        'device_not_enrolled',
        'PIN sign-in only works on a tablet an administrator has enrolled.',
      );
    }
  });

  app.decorate('setSessionCookie', (reply: FastifyReply, token: string, expiresAt: Date) => {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.COOKIE_SECURE,
      path: '/',
      expires: expiresAt,
      signed: false,
    });
  });

  app.decorate('clearSessionCookie', (reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  });
};

export const MANAGERS = MANAGER_ROLES as Role[];

export default fp(authPlugin, { name: 'auth', dependencies: ['db', 'config'] });
