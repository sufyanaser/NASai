# Forbidden Assumptions

| Do not assume                                          | Required evidence                               |
| ------------------------------------------------------ | ----------------------------------------------- |
| Expected repository files exist                        | actual tree and branch inspection               |
| Code is merged to `develop`                            | commit SHA and branch state                     |
| A command succeeded because no error was visible       | exit code and expected output/artifact          |
| Green CI means the app works                           | functional test in the target build/environment |
| A release proves automatic update                      | upgrade from an installed older version         |
| A UI control proves a feature exists                   | completed interaction and persisted result      |
| A library works on Windows because CI passed elsewhere | target Windows runtime test                     |
| Arabic is correct because build passed                 | RTL, encoding, font, and export review          |
| User data survives an update                           | migration and backup/restore test               |
| Another agent's report is sufficient evidence          | independently inspectable artifacts and effects |

Time-sensitive provider, model, API, price, and quota claims require a dated primary source or live verification.
