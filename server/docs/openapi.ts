/**
 * Static OpenAPI 3.0 specification for Guichet REST endpoints.
 *
 * Previously generated at runtime by swagger-jsdoc (which pulled in the
 * deprecated glob@7 → minimatch@3 → brace-expansion chain, introducing CVEs).
 * Converted to a static definition to eliminate that dependency entirely.
 *
 * tRPC endpoints are documented separately at /api/v1/trpc-reference.
 */

export const openapiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Guichet API',
    version: '1.0.0',
    description:
      'REST API endpoints for the Guichet multi-tenant live chat platform. tRPC endpoints are documented separately in the tRPC Reference section.',
  },
  servers: [{ url: '/api', description: 'API base' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from /auth/login-local or /auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
      UserProfile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          lang: { type: 'string', enum: ['nl', 'fr', 'en'] },
          isPlatformOperator: { type: 'boolean' },
          avatarUrl: { type: 'string', nullable: true },
        },
      },
      Membership: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          partnerId: { type: 'string' },
          partnerName: { type: 'string' },
          role: { type: 'string', enum: ['agent', 'support', 'admin'] },
          departments: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT bearer token' },
          user: { $ref: '#/components/schemas/UserProfile' },
          memberships: {
            type: 'array',
            items: { $ref: '#/components/schemas/Membership' },
          },
        },
      },
      MfaChallengeResponse: {
        type: 'object',
        properties: {
          mfaRequired: { type: 'boolean', example: true },
        },
      },
    },
  },
  paths: {
    '/auth/forgot-password': {
      post: {
        summary: 'Request a password reset email',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Always returns success to prevent user enumeration',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/auth/reset-password': {
      post: {
        summary: 'Reset password using a reset token',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string', description: 'Token from reset email' },
                  password: {
                    type: 'string',
                    minLength: 10,
                    description: 'Must meet strength requirements (upper/lower/digit/special)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Password updated and all sessions revoked' },
          '400': { description: 'Invalid/expired token or password too weak' },
        },
      },
    },
    '/auth/login-local': {
      post: {
        summary: 'Authenticate with email and password',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  totpCode: {
                    type: 'string',
                    description: '6-digit TOTP or recovery code (required if MFA enabled)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'JWT token + user profile, or MFA challenge',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/LoginResponse' },
                    { $ref: '#/components/schemas/MfaChallengeResponse' },
                  ],
                },
              },
            },
          },
          '401': { description: 'Invalid credentials or invalid MFA code' },
          '423': { description: 'Account locked due to failed attempts' },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Authenticate with user ID and password (demo mode)',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'password'],
                properties: {
                  id: { type: 'string', description: 'User ID' },
                  password: { type: 'string' },
                  totpCode: {
                    type: 'string',
                    description: '6-digit TOTP or recovery code (required if MFA enabled)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'JWT token + user profile, or MFA challenge',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/LoginResponse' },
                    { $ref: '#/components/schemas/MfaChallengeResponse' },
                  ],
                },
              },
            },
          },
          '401': { description: 'Invalid credentials' },
          '423': { description: 'Account locked' },
        },
      },
    },
    '/auth/switch-partner': {
      post: {
        summary: 'Switch active partner context',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['membershipId'],
                properties: {
                  membershipId: { type: 'string', description: 'Target membership ID' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'New JWT token scoped to the target partner' },
          '403': { description: 'Invalid membership or partner inactive' },
        },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Revoke the current session token',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Token revoked successfully' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        summary: 'Rotate refresh token and issue new access token',
        tags: ['Authentication'],
        responses: {
          '200': { description: 'New access and refresh tokens issued' },
          '401': { description: 'Invalid or expired refresh token' },
        },
      },
    },
    '/auth/enter-partner': {
      post: {
        summary: "Platform operator enters a partner's admin context",
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['partnerId'],
                properties: {
                  partnerId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'New JWT scoped to partner with admin role' },
          '403': { description: 'Not a platform operator, or step-up required, or partner inactive' },
          '404': { description: 'Partner not found' },
        },
      },
    },
    '/v1/uploads': {
      post: {
        summary: 'Upload a file attachment',
        tags: ['Uploads'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: {
                    type: 'string',
                    format: 'binary',
                    description: 'Allowed types: image/png, image/jpeg, image/webp (max 5MB)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Upload successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', description: 'Relative URL to the uploaded file' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid file type or size exceeded' },
        },
      },
    },
  },
} as const;
