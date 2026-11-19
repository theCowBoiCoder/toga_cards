<?php

namespace App\Filament\Widgets;

use App\Services\InventoryClient;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class StockStats extends StatsOverviewWidget
{
    protected static ?int $sort = 1;

    protected function getStats(): array
    {
        $snapshot = app(InventoryClient::class)->get('/api/inventory');
        $cards = collect($snapshot['cards']);
        $sales = collect($snapshot['sales']);

        return [
            Stat::make('Physical copies', number_format($cards->sum('stock')))
                ->icon('heroicon-o-square-3-stack-3d')->description('Total copies in your inventory'),
            Stat::make('Cards in stock', number_format($cards->where('stock', '>', 0)->count()))
                ->icon('heroicon-o-archive-box')->description('Unique cards with stock available'),
            Stat::make('Recorded item revenue', '£'.number_format($sales->sum('gross') / 100, 2))
                ->icon('heroicon-o-banknotes')->description('Before fees, postage and card costs'),
        ];
    }
}
