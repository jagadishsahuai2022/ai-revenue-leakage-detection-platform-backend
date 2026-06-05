-- CreateTable
CREATE TABLE "translation_overrides" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "locale" VARCHAR(10) NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translation_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_cache" (
    "id" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "sourceLang" VARCHAR(10) NOT NULL,
    "targetLang" VARCHAR(10) NOT NULL,
    "translatedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "translation_overrides_companyId_idx" ON "translation_overrides"("companyId");

-- CreateIndex
CREATE INDEX "translation_overrides_locale_idx" ON "translation_overrides"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "translation_overrides_locale_sourceText_companyId_key" ON "translation_overrides"("locale", "sourceText", "companyId");

-- CreateIndex
CREATE INDEX "translation_cache_targetLang_idx" ON "translation_cache"("targetLang");

-- CreateIndex
CREATE UNIQUE INDEX "translation_cache_sourceText_targetLang_key" ON "translation_cache"("sourceText", "targetLang");
