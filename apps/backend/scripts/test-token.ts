const token = "EAAYUUV9zVXABRufnUHZAKPuSu9GuQ5QzreFki4ogb14xQzthLKX410ZA7kdNE9o1q0ZCDuzmVBmQ1Wijp2hJR9H0xnYpZAi7S4rFaqnVtDbilynwKZAe2VBDZAoZC1PyaWpZA6ylAybn6JgDpgQUtk62WeMVa0E2iWul9lA8CvELOATHYKybrpjMHWWH0ioTvgZDZD";
const phoneId = "1085964934609759";

async function run() {
  const url = `https://graph.facebook.com/v19.0/${phoneId}?access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

run();
