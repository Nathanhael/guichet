import swaggerJsdoc from 'swagger-jsdoc';

export const openapiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Tessera API',
      version: '1.0.0',
      description: 'REST API endpoints for the Tessera multi-tenant live chat platform. tRPC endpoints are documented separately in the tRPC Reference section.',
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
  },
  apis: ['./routes/*.ts', './routes/*.js'],
});
