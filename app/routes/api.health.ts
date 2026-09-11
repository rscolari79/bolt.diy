import type { LoaderFunctionArgs } from '@remix-run/node';

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  return Response.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
};
