import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import https from "https";

dotenv.config({ path: path.join(__dirname, "../../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

// Custom fetch using native https to bypass undici/fetch timeouts
const customFetch = (url: string | URL, options: any = {}): Promise<any> => {
  return new Promise((resolve, reject) => {
    const urlStr = url.toString();
    const urlObj = new URL(urlStr);
    const method = options.method || "GET";
    const body = options.body;

    const headers: Record<string, string> = {};
    if (options.headers) {
      if (typeof options.headers.forEach === "function") {
        options.headers.forEach((val: string, key: string) => {
          headers[key] = val;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const reqOptions: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: any[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const textContent = buffer.toString("utf8");
        resolve({
          ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
          status: res.statusCode || 0,
          statusText: res.statusMessage || "",
          text: async () => textContent,
          json: async () => JSON.parse(textContent),
          headers: {
            get: (name: string) => {
              const val = res.headers[name.toLowerCase()];
              return Array.isArray(val) ? val.join(", ") : val || null;
            },
          },
        });
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
};

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
  global: { fetch: customFetch as any }
});

async function main() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error("Error listing buckets:", error);
    return;
  }

  console.log("=== Storage Buckets ===");
  for (const bucket of buckets) {
    console.log(`Bucket Name: ${bucket.name}, Public: ${bucket.public}`);
    const { data: files, error: filesError } = await supabase.storage.from(bucket.name).list("", { limit: 100 });
    if (filesError) {
      console.error(`  Error listing files in bucket ${bucket.name}:`, filesError);
    } else {
      console.log(`  Files count: ${files?.length || 0}`);
      for (const file of files?.slice(0, 10) || []) {
        console.log(`    - ${file.name} (size: ${file.metadata?.size || 0} bytes, created: ${file.created_at})`);
      }
      if (files && files.length > 10) {
        console.log(`    ... and ${files.length - 10} more files`);
      }
    }
  }
}

main().catch(console.error);
