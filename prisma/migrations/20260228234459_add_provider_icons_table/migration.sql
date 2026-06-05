-- CreateTable
CREATE TABLE "provider_icons" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "icon_bg" VARCHAR(7) NOT NULL,
    "icon_svg_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_built_in" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_icons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_icons_key_key" ON "provider_icons"("key");

-- CreateIndex
CREATE INDEX "provider_icons_key_idx" ON "provider_icons"("key");
