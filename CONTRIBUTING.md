# Contributing

Thanks for helping improve this project.

## Reporting a problem

Please open an issue and include:

- PLC model and firmware version (for example Micro850 2080-LC50-48QWB, firmware 20.011)
- Node-RED and Node.js versions
- The tag's data type and the exact error or status text shown on the node
- Whether the tag is a global variable, and its External access setting in CCW

Reports that something **works** on real hardware are just as useful. Please include the model.

## Making changes

1. Fork the repository and create a branch.
2. Make your change. The runtime has no dependencies, so please do not add any.
3. Run `npm test` and make sure it passes. Add a test for new protocol behaviour where practical (`test/mock-test.js`).
4. Update `README.md` and `CHANGELOG.md` when behaviour changes.
5. Open a pull request describing what changed and why.

## Style

- Plain Node.js (CommonJS), 2-space indentation, single quotes.
- Keep the client in `lib/` free of Node-RED code so it can be tested on its own.
