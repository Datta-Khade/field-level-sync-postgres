/**
 * Define all source databases here.
 * Add or remove entries as needed.
 * Each entry is one independent CDC poller.
 */
module.exports = [
  {
    id       : 'crew_management_erp',    // unique identifier
    host     : process.env.DB1_HOST,
    port     : parseInt(process.env.DB1_PORT),
    database : process.env.DB1_NAME,
    user     : process.env.DB1_USER,
    password : process.env.DB1_PASS,
    slotName : process.env.DB1_SLOT,
    enabled  : true,
  },
  {
    id       : 'crew_management',
    host     : process.env.DB2_HOST,
    port     : parseInt(process.env.DB2_PORT),
    database : process.env.DB2_NAME,
    user     : process.env.DB2_USER,
    password : process.env.DB2_PASS,
    slotName : process.env.DB2_SLOT,
    enabled  : true,
  },
//   {
//     id       : 'hr_db',
//     host     : process.env.DB3_HOST,
//     port     : parseInt(process.env.DB3_PORT),
//     database : process.env.DB3_NAME,
//     user     : process.env.DB3_USER,
//     password : process.env.DB3_PASS,
//     slotName : process.env.DB3_SLOT,
//     enabled  : true,
//   },
];