const fs = require("fs");
const path = require("path");

const NEW_APP_NAME = "KeSach";
const OLD_APP_NAMES = ["Koodo Reader", "koodo-reader"];
const MIGRATION_MARKER = ".migrated-from-koodo";

/**
 * One-time migration of the old Koodo Reader userData folder to KeSach.
 * Must run before electron-store and app.getPath("userData") consumers.
 * Returns the new userData directory (whether or not migration happened).
 */
const migrateUserData = (app) => {
  const appData = app.getPath("appData");
  const newDir = path.join(appData, NEW_APP_NAME);
  try {
    if (fs.existsSync(path.join(newDir, MIGRATION_MARKER))) {
      return newDir;
    }
    const oldDir = OLD_APP_NAMES.map((name) => path.join(appData, name)).find(
      (dir) => fs.existsSync(dir)
    );
    if (!oldDir) {
      return newDir;
    }
    const newDirHasContent =
      fs.existsSync(newDir) && fs.readdirSync(newDir).length > 0;
    if (newDirHasContent) {
      return newDir;
    }
    fs.mkdirSync(newDir, { recursive: true });
    fs.cpSync(oldDir, newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "");
    console.info(`Migrated user data from ${oldDir} to ${newDir}`);
    return newDir;
  } catch (error) {
    console.error("Failed to migrate user data:", error);
    return newDir;
  }
};

module.exports = {
  NEW_APP_NAME,
  migrateUserData,
};
