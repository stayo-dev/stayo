-- AlterTable: make hostel_id nullable on expenses so business-level expenses can exist without a hostel
ALTER TABLE "expenses" ALTER COLUMN "hostel_id" DROP NOT NULL;
