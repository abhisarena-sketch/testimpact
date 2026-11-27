# Support

- **Questions and ideas**: open a [GitHub Discussion](https://github.com/abhisarena-sketch/testimpact/discussions) (if enabled) or an issue labelled `question`.
- **Bugs**: open an [issue](https://github.com/abhisarena-sketch/testimpact/issues) with your TestImpact version (`testimpact --version`), Node.js version, the command you ran, and, if possible, the JSON report (`--format json`) or a minimal repository that reproduces the problem. Reports contain file paths but no source code.
- **Wrong recommendations**: run `testimpact explain <TEST-ID>` and include the output. For a missed test, describe how the test depends on the changed file (import, runtime file access, CLI invocation, …).
- **Security issues**: follow [SECURITY.md](SECURITY.md); do not file public issues.

Before asking, check [Known limitations](docs/limitations.md) and the [compatibility matrix](docs/compatibility.md).

TestImpact is maintained by Workfonic Labs on a best-effort basis. There is no commercial support agreement.
