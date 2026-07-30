import https from "https";

https.get("https://iogmfxedhfcdtxoywwve.supabase.co/storage/v1/bucket", (res) => {
  console.log("HTTPS status code:", res.statusCode);
  res.on("data", (d) => {
    process.stdout.write(d);
  });
}).on("error", (e) => {
  console.error("HTTPS error:", e);
});
