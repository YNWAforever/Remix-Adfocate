import {
  publicationProofReleaseSummary,
  seedPublicationProofReleaseFixture,
} from "../server/test/fixtures/publicationProofRelease";

const fixture = await seedPublicationProofReleaseFixture();
process.stdout.write(`${JSON.stringify(publicationProofReleaseSummary(fixture), null, 2)}\n`);
