<?php

use App\Filament\Pages\Inventory;
use App\Http\Controllers\AdminConnectionController;
use App\Http\Controllers\CustomerAccountController;
use App\Http\Controllers\CustomerCollectionController;
use App\Http\Controllers\CustomerOrdersController;
use App\Http\Middleware\CustomerResponseHeaders;
use App\Services\InventoryClient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::prefix('account')->middleware([CustomerResponseHeaders::class])->group(function (): void {
    Route::get('/session', [CustomerAccountController::class, 'session'])->name('customer.session');
    Route::get('/login', fn () => app(CustomerAccountController::class)->form('login'))->name('customer.login');
    Route::get('/register', fn () => app(CustomerAccountController::class)->form('register'))->name('customer.register');
    Route::get('/forgot-password', fn () => app(CustomerAccountController::class)->form('forgot-password'))->name('password.request');
    Route::get('/reset-password/{token}', [CustomerAccountController::class, 'resetForm'])->name('password.reset');
    Route::post('/login', [CustomerAccountController::class, 'login'])->middleware('throttle:6,1');
    Route::post('/register', [CustomerAccountController::class, 'register'])->middleware('throttle:6,1');
    Route::post('/forgot-password', [CustomerAccountController::class, 'forgot'])->middleware('throttle:3,1')->name('password.email');
    Route::post('/reset-password', [CustomerAccountController::class, 'reset'])->middleware('throttle:6,1')->name('password.update');
    Route::middleware(['auth:customer', 'auth.session'])->group(function (): void {
        Route::get('/', fn () => redirect()->route('customer.orders'));
        Route::post('/logout', [CustomerAccountController::class, 'logout'])->name('customer.logout');
        Route::get('/profile', [CustomerAccountController::class, 'profile'])->name('customer.profile');
        Route::post('/profile', [CustomerAccountController::class, 'saveProfile'])->middleware('throttle:6,1');
        Route::get('/orders', [CustomerOrdersController::class, 'index'])->name('customer.orders');
        Route::get('/orders/{orderId}', [CustomerOrdersController::class, 'show'])->whereUuid('orderId')->name('customer.order');
        Route::post('/orders/{orderId}/return', [CustomerOrdersController::class, 'requestReturn'])->whereUuid('orderId')->middleware('throttle:10,1')->name('customer.return');
        Route::post('/checkout', [CustomerOrdersController::class, 'checkout'])->middleware('throttle:6,1');
        Route::get('/collection', [CustomerCollectionController::class, 'index'])->name('customer.collection');
        Route::post('/collection/{cardId}', [CustomerCollectionController::class, 'save'])->whereNumber('cardId')->middleware('throttle:60,1')->name('customer.collection.save');
    });
});

Route::get('/api/health', function (InventoryClient $client) {
    try {
        DB::select('SELECT 1 FROM users LIMIT 1');

        return response()->json($client->health())->header('Cache-Control', 'no-store');
    } catch (Throwable $exception) {
        return response()->json(['ok' => false], 503);
    }
});
Route::middleware(['auth'])->group(function () {
    Route::get('/admin/website', function () {
        abort_unless(Inventory::canAccess(), 403);

        return redirect()->route('filament.admin.pages.inventory');
    })->name('admin.website');
    Route::post('/admin/ebay/connect', [AdminConnectionController::class, 'connect'])->name('admin.ebay.connect');
    Route::get('/admin/export/{kind}', [AdminConnectionController::class, 'export'])->whereIn('kind', ['inventory', 'sales'])->name('admin.export');
});
