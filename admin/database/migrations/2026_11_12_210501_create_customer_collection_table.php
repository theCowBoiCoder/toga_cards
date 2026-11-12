<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->string('account_type')->default('staff'));
        Schema::create('customer_collection', function (Blueprint $table): void {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('card_id');
            $table->unsignedInteger('owned')->default(0);
            $table->unsignedInteger('wanted')->default(0);
            $table->timestamp('updated_at');
            $table->primary(['user_id', 'card_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_collection');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('account_type'));
    }
};
