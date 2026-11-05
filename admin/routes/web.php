<?php

use App\Http\Controllers\AdminConnectionController;
use App\Services\InventoryClient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/api/health', function (InventoryClient $client) {
    try {
        DB::select('SELECT 1 FROM users LIMIT 1');

        return response()->json($client->health())->header('Cache-Control', 'no-store');
    } catch (Throwable $exception) {
        return response()->json(['ok' => false], 503);
    }
});
Route::middleware(['auth'])->group(function () {
    Route::post('/admin/ebay/connect', [AdminConnectionController::class, 'connect'])->name('admin.ebay.connect');
    Route::get('/admin/export/{kind}', [AdminConnectionController::class, 'export'])->whereIn('kind', ['inventory', 'sales'])->name('admin.export');
});
