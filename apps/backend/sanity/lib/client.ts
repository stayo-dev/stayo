import { createClient } from 'next-sanity'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'dummy-project-id';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2026-06-01';

// Sanity project ID must contain only a-z, 0-9 and dashes
const isValidProjectId = /^[a-z0-9-]+$/i.test(projectId);
const safeProjectId = isValidProjectId ? projectId : 'dummy-project-id';

export const client = createClient({
  projectId: safeProjectId,
  dataset,
  apiVersion,
  useCdn: false,
})

export function getClient(previewToken?: string) {
  if (previewToken) {
    return createClient({
      projectId: safeProjectId,
      dataset,
      apiVersion,
      useCdn: false,
      token: previewToken,
    });
  }
  return client;
}

