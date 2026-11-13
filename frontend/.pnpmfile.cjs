// openapi-typescript drives the TypeScript 5 compiler API, which TypeScript 7 no longer ships. Give
// it its own TypeScript 5 instead of the app's TypeScript 7, which pnpm would otherwise supply as its peer.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "openapi-typescript") {
        delete pkg.peerDependencies?.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: "5.9.3" };
      }
      return pkg;
    },
  },
};
