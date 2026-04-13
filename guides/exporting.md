# Exporting a vault

Every vault you can access, personal or shared, can be exported as a zip of markdown files. Open the vault's settings page and click Export vault. The platform queues a background job, and the page shows the status as the job runs.

When the job finishes, a Download zip link appears. The archive contains one `.md` file per note, arranged into folders that mirror the structure inside the vault. Wiki-links are written into the markdown exactly as you typed them. If you open the archive in Obsidian or any other tool that understands wiki-links, the links resolve again.

The platform also runs an automatic export every night for every vault. These nightly exports are kept on the server and can be retrieved by contacting the operator. Triggering a manual export does not disturb the nightly schedule.

If an export fails, the page shows an error message. Try again a few minutes later. If it keeps failing, contact the operator with the job id shown on the page.
