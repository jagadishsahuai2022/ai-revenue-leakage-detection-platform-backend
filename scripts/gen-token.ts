import jwt from "jsonwebtoken";

const token = jwt.sign(
  {
    sub: "cmm6ldhuk0004t93v33i6z4u8",
    cid: "cmm6ldhtv0000t93vk8oic1om",
    role: "ANALYST",
    email: "analyst@demo.com",
  },
  "dev_jwt_secret_change_me_please_32_chars",
  { expiresIn: "1h" },
);
console.log(token);
