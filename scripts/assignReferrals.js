const { assignReferralsToUser } = require("../utils/referralService");

const OWNER_ID = "732566370914664499";

// Put real Discord user IDs here
const USER_IDS = [
  "197252595822231552",
  "1236736719353548900",
  "540375409737334816",
  "732751467449942088",
  "1356693919773229186"
];

(async () => {
  await assignReferralsToUser(OWNER_ID, USER_IDS);
  process.exit(0);
})();
